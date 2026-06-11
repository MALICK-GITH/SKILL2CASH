# Explication du Système OCR - Duel Validation
## Pour DokU

---

## 1. Vue d'ensemble du flux

Quand deux joueurs finissent un match sur eFootball, ils doivent prouver le résultat. Voici ce qui se passe :

```
Joueur 1 envoie sa preuve (score + screenshot)
           ↓
Joueur 2 envoie sa preuve (score + screenshot)
           ↓
   Les 2 preuves sont reçues → Queue Redis BullMQ
           ↓
   Worker OCR démarre l'analyse en arrière-plan
           ↓
   OCR lit les textes sur les 2 captures d'écran
           ↓
   Système valide : même score ? même gagnant ?
           ↓
   OUI → Paiement automatique
   NON → Litige admin (review manuelle)
```

---

## 2. Les composants du système

### A. Route API (`duelRoutes.js`)
- Point d'entrée : `POST /duel/:id/result`
- Vérifie que le joueur envoie bien `score`, `declaredWinner`, `screenshot`
- Délègue au service `submitResult()`

### B. Service de soumission (`duelService.js`)
- Valide l'image (PNG/JPEG/WEBP, entre 10Ko et 1Mo)
- Empêche la double soumission du même joueur
- Change le statut :
  - `waiting_player2_proof` (si J1 a envoyé)
  - `waiting_player1_proof` (si J2 a envoyé)
  - `analyzing` (si les 2 ont envoyé)
- Quand les 2 preuves sont là : **déclenche l'OCR** en ajoutant un job à la queue

### C. Queue Redis (`duelOcrQueue.js`)
- Utilise **BullMQ** + **Redis** pour gérer la file d'attente
- Chaque duel reçoit un `jobId` unique : `duel-ocr-<duelId>`
- Retry automatique : 2 tentatives avec backoff exponentiel (5s → 10s)
- Nettoyage auto : conserve 100 jobs réussis (1h), 500 échoués (24h)

### D. Worker OCR (`server.js` / `duelOcrWorker.js`)
- **Mode in-process** : worker lancé dans le serveur HTTP (dev/local)
- **Mode standalone** : worker lancé séparément pour plus de puissance (production)
- Limitation de débit : max 10 jobs/min pour éviter de surcharger Tesseract
- Concurrency : 2 jobs en parallèle max

### E. Service OCR (`ocrService.js`)
Le cœur du traitement d'image :

1. **Décode l'image** base64 → buffer
2. **Pré-traitement** avec Sharp :
   - Redimensionnement (1200px large)
   - Niveaux de gris
   - Normalisation du contraste
   - Renforcement des bords
3. **Génération de variants** : plusieurs recadrages possibles du score
4. **Reconnaissance Tesseract.js** : lit le texte sur chaque variant
5. **Extraction du score** : patterns comme `2-1`, `3-0`, `FT 2-2`
6. **Détection des noms** : vérifie que les pseudos des joueurs apparaissent
7. **Hash anti-fraude** : SHA-256 de l'image pour détecter si J1 et J2 envoient la même capture

---

## 3. Validation automatique (`shouldAutoApproveWithOcr`)

Pour qu'un duel soit **auto-approuvé**, toutes ces conditions doivent être vraies :

| Critère | Seuil |
|---------|-------|
| Les 2 captures sont différentes (anti-fraude) | Hash ≠ |
| Les 2 joueurs déclarent le même score | Strict |
| Les 2 joueurs déclarent le même gagnant | Strict |
| Confiance OCR ≥ 85% sur les 2 captures | 85% |
| Confiance OCR conditionnelle (review humain) | 68-84% |
| Score OCR correspond au score déclaré | Match exact |
| Gagnant probable OCR correspond au gagnant déclaré | Match |
| Noms joueurs détectés ET confiance > 80% | Les deux conditions requises |

Si tout est OK → **Paiement automatique**, duel terminé.
Si un seul critère échoue → **Litige**, admin notifié pour review manuelle.

---

## 4. Mécanismes de protection

### IMPORTANT : OCR ≠ CRON Job

Le système OCR est **événementiel (event-driven)**, pas un CRON qui tourne toutes les X minutes.

- Quand les 2 preuves arrivent → **immédiatement**, un job est poussé dans Redis BullMQ
- Le Worker OCR démarre **instantanément** (pas d'attente planifiée)
- C'est comme une file d'attente au supermarché : dès qu'un client arrive (événement), le caissier (worker) le traite

**Seul le Watchdog tourne en CRON** (toutes les 2 min) pour récupérer les duels bloqués si le worker a crashé.

### A. Timeout OCR adaptatif
- Image normale (< 500Ko) → timeout **3 minutes**
- Image lourde (> 500Ko) → timeout **6 minutes**
- Si timeout : duel passé en `dispute` automatiquement

### B. Watchdog runtime (NOUVEAU)
- Scan toutes les **2 minutes** les duels bloqués en `analyzing`
- **Notification proactive à 5 minutes** : si un duel est en analyse depuis 5 minutes → notification "L'analyse prend plus de temps que prévu..." aux joueurs et admins
- Si un duel est en analyse depuis **+10 minutes** → forcé en `dispute`
- **Problème résolu :** plus jamais de "Analyse en cours" pendant des heures, et feedback utilisateur rapide

### C. Recovery au boot (`recoverFromCrash`)
- Au démarrage du serveur : scanne les duels stuck depuis 24h
- Duel actif depuis 2h sans résultat → remboursement auto
- Duel avec preuves mais bloqué → escalade admin

### D. Distributed Locks (Anti-race conditions)

**Problème** : Le watchdog et le worker OCR peuvent essayer de modifier le même duel simultanément (race condition).

**Solution** : Verrous distribués par duel :

```javascript
// Avant tout changement d'état
const lock = await acquireDuelLock(duelId, { ttl: 30000 }); // 30s TTL
if (!lock) return; // Déjà traité par un autre process

try {
  // Vérifier l'état actuel
  const duel = await Duel.findById(duelId);
  if (duel.status !== 'analyzing') return; // Déjà traité
  
  // Effectuer le remboursement ou la complétion
  await processDuel(duel);
  
  // Audit log
  await logAction({
    duelId,
    action: 'refund|completion',
    operator: 'system|worker',
    timestamp: new Date(),
    reason: 'timeout|success'
  });
} finally {
  await releaseDuelLock(duelId);
}
```

- **Redis** utilisé comme store de locks (atomic `SET NX EX`)
- **TTL** automatique pour éviter les locks orphelins
- **Audit complet** : duelId, timestamp, opérateur (worker ID ou 'system'), raison

### E. Pool de workers Tesseract
- 2 workers réutilisables pour éviter le coût de création à chaque OCR
- Chaque worker est re-rangé dans le pool après usage
- Si le pool est plein, le worker est terminé proprement

---

## 5. Corrections récentes (bug fixes)

### Bug 1 : Double Worker / Double Processing (CRITIQUE)
**Problème** : Le serveur HTTP et le worker standalone consommaient la même queue → un duel traité 2 fois en parallèle → risque de double paiement.

**Fix multi-couches** :

1. **Gating par variable d'environnement** (`SKILL2CASH_OCR_WORKER_MODE`)
   - `standalone` → serveur HTTP ne lance PAS de worker interne
   - Non définie (dev) → worker in-process actif

2. **Job Deduplication** (BullMQ)
   - Pattern de job ID : `duel-ocr-${duelId}` (unique par duel)
   - BullMQ rejette automatiquement les doublons avec même ID

3. **Idempotence des paiements**
   - Clé d'idempotence par duel : `payment-${duelId}`
   - Retry sur le même duel = no-op si paiement déjà effectué
   - Vérification atomique : `if (duel.status === 'finished') return;`

4. **Transitions d'état atomiques**
   - `analyzing → finished` : vérification du status actuel avant update
   - Utilisation de transactions MongoDB avec re-vérification du statut

5. **Tests automatisés**
   - Simulation de jobs concurrents (même duel soumis 10× simultanément)
   - Vérification : 1 seul paiement effectué, 9 no-op

### Bug 2 : Fuite de connexion Redis
**Problème** : Au shutdown (`SIGTERM`), la connexion Redis du worker restait ouverte.

**Fix** : `gracefulShutdown()` ferme maintenant dans l'ordre :
1. Worker BullMQ
2. Queue BullMQ
3. Connexion Redis

### Bug 3 : Rate limiter trop restrictif
**Problème** : Max 5 jobs/min empêchait plusieurs duels de finir en même temps.

**Fix** : Augmenté à **10 jobs/min** sur les deux modes (in-process + standalone).

---

## 6. Notifications envoyées

| Événement | Destinataire |
|-----------|-------------|
| `duel:proof_submitted` | Joueur qui a envoyé |
| `duel:proof_received` | Adversaire ("ta preuve est arrivée") |
| `duel:analysis_started` | Les 2 joueurs ("analyse en cours") |
| `duel:ocr_processed` | Room ("OCR terminé") |
| `duel:result_submitted` | Room ("résultat soumis") |
| `duel:finished` | Room + 2 joueurs (si auto-approuvé) |
| `duel:dispute_opened` | Room + admin (si litige) |
| `admin:dispute_pending` | Admins ("un duel nécessite review") |
| `duel:review_required` | Les 2 joueurs ("litige, admin va décider") |

---

## 7. Schéma de données OCR stocké

Pour chaque duel, on sauvegarde :

```js
// Joueur 1
duel.ocrTextPlayer1           // Texte brut OCR
duel.ocrScorePlayer1          // Score détecté (ex: "2-1")
duel.ocrScoreCandidatesPlayer1 // Tous les scores candidats
duel.ocrPlayersDetectedPlayer1   // Noms détectés
duel.ocrConfidencePlayer1     // Confiance % (0-100)

// Joueur 2 (même structure)
duel.ocrTextPlayer2
...

// Hash anti-fraude
duel.resultPlayer1.imageHash   // SHA-256
duel.resultPlayer2.imageHash

// Validation
duel.autoValidationStatus    // 'auto_approved' | 'manual_review' | 'failed' | 'pending'
duel.autoValidationReason    // Explication textuelle
```

### Protection des données (GDPR/CCPA)

**Problème** : Les captures d'écran peuvent contenir des PII (Personally Identifiable Information) : emails, noms réels, noms d'appareil, etc.

**Solution implémentée** :

1. **Cropping automatique** : Avant l'OCR, les images sont recadrées sur les zones de score uniquement (utilisation des mêmes variants que pour l'extraction du score)

2. **Sanitization du texte OCR** : Fonction `sanitizeOcrText()` qui :
   - Supprime les patterns email (`*@*.com`)
   - Redige les noms d'appareil (`Galaxy S21`, `iPhone 12`)
   - Filtre les tokens non-liés au score (heures, dates, IDs)
   - Ne conserve que : patterns de score (`2-1`, `3-0`), indicateurs de match (`FT`, `Final`), et noms des joueurs du duel

3. **Stockage minimal** :
   - `duel.ocrTextPlayer1/2` → texte sanitizé uniquement (ou vide si trop de PII)
   - `duel.ocrScorePlayer1/2` → toujours conservé (pas de PII)
   - `duel.ocrScoreCandidatesPlayer1/2` → conservé
   - Pas de stockage de l'image complète post-traitement

4. **Politique de rétention** : Les données OCR brutes sont nettoyées selon la même politique que les jobs BullMQ (max 24h pour les échecs)

---

## 7b. Détection de fraude avancée

### Pipeline de vérification anti-fraude

L'ancienne méthode SHA-256 ne détectait que les images **exactement identiques**. Un joueur pouvait recadrer, compresser, ou retoucher légèrement la même capture pour passer la vérification.

**Nouveau pipeline** (3 couches de protection) :

1. **Perceptual Hashing (pHash/dHash)**
   - Bibliothèque : `sharp` + `phash` ou `imagehash` équivalent Node.js
   - Génère un hash "perceptuel" basé sur la structure visuelle, pas les pixels exacts
   - Tolérance aux modifications : recadrage 10%, compression JPEG, ajustements mineurs

2. **SSIM (Structural Similarity Index)**
   - Bibliothèque : `ssim.js` ou `sharp` + calcul custom
   - Score de similarité entre 0 et 1
   - Seuil de fraude : SSIM > 0.85 (images très similaires malgré les modifications)

3. **Analyse des métadonnées (EXIF)**
   - Horodatage de capture (doit être cohérent avec le temps du match)
   - Modèle d'appareil (les deux joueurs utilisent-ils le même téléphone ?)
   - Géolocalisation (si disponible)
   - Logiciel de modification (Photoshop, etc.)

### Logique de décision fraude

```
SI (pHash1 == pHash2) → FRAUDE (images structurellement identiques)
SINON SI (SSIM > 0.85) → FRAUDE PROBABLE (analyse humaine requise)
SINON SI (timestamp identique à la seconde près) → FRAUDE PROBABLE
SINON SI (même appareil ET timestamps très proches) → SUSPICION
SINON → PAS DE FRAUDE
```

---

## 8. Stack technique OCR

| Composant | Technologie |
|-----------|-------------|
| Queue de jobs | BullMQ |
| Base de données jobs | Redis |
| Pré-traitement image | Sharp (Node.js) |
| OCR (reconnaissance texte) | Tesseract.js |
| Détection fraude | **Perceptual Hashing (pHash/dHash) + SSIM + Métadonnées** |
| Matching noms | Levenshtein distance (fuzzy) |
| Extraction scores | Regex + heuristique |

---

## Résumé pour DokU

> Quand un duel finit, les deux joueurs envoient leur capture. Le système met le duel en file d'attente Redis. Un worker OCR lit les scores sur les images avec Tesseract. Si les deux captures sont cohérentes (même score, même gagnant, pas de fraude, confiance suffisante), le paiement se fait automatiquement. Sinon, un admin est appelé pour trancher. Tout est protégé par timeouts, watchdogs, et recovery au boot pour éviter les duels bloqués à l'infini.

---
*Signé : SOLITAIRE HACK*
