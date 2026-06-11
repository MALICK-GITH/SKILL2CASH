# Inscription Simplifiée pour Débutants

## Avant (inscription classique)
**7 champs obligatoires :**
```
POST /auth/register
{
  "username": "...",
  "efootballUsername": "...", 
  "firstName": "...",
  "lastName": "...",
  "phone": "...",
  "email": "...",
  "password": "..."
}
```

## Après (inscription rapide pour débutants)
**3 champs obligatoires seulement :**
```
POST /auth/register-quick
{
  "email": "...",
  "password": "...",
  "efootballUsername": "..."  // OBLIGATOIRE - doit correspondre au profil eFootball
}
```

> ⚠️ **Important OCR** : Le pseudo eFootball doit être exactement celui affiché sur les captures d'écran du match. Sans cela, le système OCR ne pourra pas valider les preuves.

## Ce qui est généré automatiquement

| Champ | Valeur par défaut |
|-------|-------------------|
| `username` | Dérivé de l'email + suffixe random |
| `firstName` | "Player" |
| `lastName` | Efootball username |
| `phone` | Temporaire (TEMPxxx) |
| `country` | "Global" |
| `efootballUsername` | **Fourni par l'utilisateur** (requis pour OCR) |

## Routes API ajoutées

### 1. `/auth/register-quick` (POST)
Inscription ultra-rapide pour les débutants.

**Body requis :**
- `email` (requis) - doit être unique
- `password` (requis) - minimum 8 caractères
- `efootballUsername` (requis) - doit correspondre exactement au pseudo eFootball du joueur

**Réponse :**
```json
{
  "success": true,
  "message": "Compte créé avec succès ! Complétez votre profil quand vous voulez.",
  "token": "...",
  "user": { ... }
}
```

### 2. `/auth/complete-profile` (PATCH)
Permet de compléter son profil plus tard (nécessite d'être connecté).

**Body optionnel :**
- `firstName` - Prénom
- `lastName` - Nom de famille  
- `phone` - Numéro de téléphone (vrai numéro, pas TEMP)
- `country` - Pays
- ⚠️ `efootballUsername` - **Non modifiable** si des preuves de match existent (pour préservation OCR)

**Exemple :**
```javascript
import { completeProfile } from './api';

await completeProfile({
  firstName: 'John',
  lastName: 'Doe',
  phone: '+33612345678',
  country: 'France',
  efootballUsername: 'ProGamer_2024'
});
```

## Frontend API ajouté

```javascript
// Inscription rapide
import { registerQuick } from './api';

const response = await registerQuick(
  'john@email.com',      // email
  'monpassword123',      // password (8 caractères min)
  'MonPseudoEFootball'   // efootballUsername (OBLIGATOIRE pour OCR)
);

// Compte créé et connecté automatiquement !
```

## Flux utilisateur pour débutants

```
┌─────────────────────────────────────────┐
│  Formulaire simple (3 champs)           │
│  - Email                                │
│  - Mot de passe                         │
│  - Pseudo eFootball - OBLIGATOIRE       │
└─────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  Compte créé + Connecté automatiquement │
│  → Peut jouer immédiatement !            │
└─────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  [Plus tard] Popup douce :              │
│  "Complète ton profil pour gagner plus" │
│  → Prénom, nom, téléphone, pays...      │
└─────────────────────────────────────────┘
```

## Validation des données

### Mots de passe
- `/register` (classique) : minimum 8 caractères
- `/register-quick` (débutant) : minimum 8 caractères (même sécurité)
- Rate limiting activé sur `/register-quick`
- Email requis (avec vérification recommandée)

### Téléphone temporaire
- Format : `TEMP<timestamp>` (ex: `TEMPK9XP2A`)
- L'utilisateur **doit** le remplacer par un vrai numéro via `complete-profile`
- **Règle de validation** : 
  - Rejette toute nouvelle valeur commençant par "TEMP"
  - Permet le remplacement : ancien TEMP → nouveau numéro réel
  - Bloque : numéro réel → TEMP

## Avantages

| Avant | Après |
|-------|-------|
| 7 champs à remplir | **3 champs obligatoires (sécurisés)** |
| Friction élevée = abandons | Friction réduite = conversions ↑ |
| Pseudo eFootball + username + nom/prénom | **Juste email + password + pseudo eFootball** |
| Doit donner son vrai téléphone | Temporaire, complétable après |
| 2-3 minutes d'inscription | **30-45 secondes** |

## Sécurité

- Email unique requis
- Vérification doublon sur efootballUsername (doit être unique)
- Hashage bcrypt du mot de passe (12 rounds)
- JWT token avec expiration
- Notification admin sur inscription rapide (`admin:new_user_quick`)

## Recommandation UX

**Page d'inscription pour débutants :**
1. Formulaire visible : Email + Mot de passe + Pseudo eFootball (3 champs)
2. Message aide : "Entrez votre pseudo eFootball exact (pour la validation OCR)"
3. Bouton : "Créer mon compte →"
4. Message : "Tu pourras compléter ton profil plus tard"

**Première connexion (dashboard) :**
- Bannière douce : "🎉 Bienvenue ! Complète ton profil pour débloquer toutes les fonctionnalités"
- Bouton : "Compléter maintenant" / "Plus tard"
- Ne pas bloquer l'utilisateur, laisser jouer immédiatement

---
*Signé : SOLITAIRE HACK*
