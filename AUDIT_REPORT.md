# Rapport d'audit SKILL2CASH

Date: 26 avril 2026  
Contexte: audit senior dev + QA avant lancement

## Fonctions OK

- Backend Express démarre correctement en mode `start:memory` avec replica set MongoDB mémoire.
- Frontend Vite démarre sur `http://localhost:5173`.
- Login admin fonctionne après seed: `admin@skill2cash.test / password123`.
- Connexion navigateur vérifiée avec Playwright, sans erreur console après login.
- Inscription joueur avec username/eFootball username vérifiée.
- Route admin protégée sans JWT.
- Défi contre soi-même refusé.
- Défi sans solde disponible refusé.
- Dépôt manuel `pending` ne crédite pas le wallet.
- Dépôt `approved` crédite le wallet et crée une transaction.
- Dépôt `rejected` ne crédite pas.
- Double validation d'un dépôt refusée.
- Acceptation de défi bloque les mises des deux joueurs.
- OCR faible ou capture invalide envoie le duel en litige.
- Résolution admin d'un litige débloque les fonds, paie le gagnant, applique la commission.
- Double résolution d'un duel terminé refusée.
- Retrait supérieur au solde refusé.
- Leaderboard répond correctement.

## Bugs trouvés

- Critique: l'OCR auto-approuvait un duel si les deux joueurs déclaraient le même résultat, même avec OCR faible ou échoué.
- Critique: `dev:mongo` utilisait une base MongoDB standalone locale, incompatible avec les transactions wallet.
- Critique: Tesseract.js pouvait faire tomber le process sur une image PNG corrompue/minuscule.
- Sécurité API: résoudre deux fois un duel terminé retournait succès.
- Frontend: crash React après login, `liveFeed is not defined`.
- Frontend: handlers Socket.io appelaient `setWallet` hors scope.
- Build: PostCSS chargeait Tailwind v4 avec l'ancien plugin `tailwindcss`.
- Build: Vite demandait `terser` alors que la dépendance n'était pas installée.
- UX: progression de niveau affichait un montant négatif.

## Bugs corrigés

- OCR strict rétabli: pas de paiement si confiance OCR < 85%, noms manquants, score incohérent ou OCR échoué.
- Ajout d'une validation au démarrage: MongoDB doit être replica set ou mongos pour les opérations financières.
- Rejet OCR avant Tesseract pour les captures de match invalides ou trop petites.
- Double résolution d'un duel terminé maintenant refusée.
- `liveFeed` passé correctement au Dashboard.
- Suppression des appels `setWallet` invalides dans les events globaux Socket.io.
- Frontend repassé sur `styles.css`; PostCSS ne charge plus Tailwind.
- Build Vite repassé sur minification `esbuild`.
- Progression niveau: affichage `Niveau maximum atteint` au lieu d'un montant négatif.
- Champ `efootballUsername` ajouté et synchronisé avec `username`.

## Bugs restants

- `npm run dev:mongo` ne peut pas être validé avec le `.env` actuel, car `MONGO_URI=mongodb://127.0.0.1:27017/skill2cash` pointe vers MongoDB standalone. C'est volontairement bloqué pour éviter des opérations wallet non transactionnelles.
- Pour valider la persistance Atlas, remettre une URI `mongodb+srv://...` Atlas dans `backend/.env`, puis lancer `npm run seed` et `npm run dev:mongo`.
- Plusieurs textes restent mixtes français/anglais dans l'UI. Ce n'est pas un bug financier, mais à nettoyer avant lancement public.

## Sécurité vérifiée

- JWT requis pour routes wallet, challenge, duel et admin.
- Rôle admin requis sur `/api/admin/*`.
- Wallet non modifiable directement côté frontend.
- Dépôt non crédité sans validation admin.
- Double validation dépôt bloquée.
- Double résolution duel bloquée.
- Duel contre soi-même bloqué.
- Défi sans solde bloqué.
- Retrait supérieur au solde bloqué.
- Username officiel lié au nom eFootball, changement soumis à validation admin.

## Wallet vérifié

- Dépôt pending: aucun crédit.
- Dépôt approved: `balanceAvailable`, `balanceTotal`, `totalDeposited` augmentent.
- Dépôt rejected: aucun changement wallet.
- Acceptation challenge: mise soustraite du disponible et ajoutée au locked pour les deux joueurs.
- Litige: fonds restent locked.
- Résolution admin: locked revient à 0, gagnant reçoit pot moins commission.
- Commission testée: duel 5 000 + 5 000, taux 8%, commission 800, gain net 9 200.
- Aucune double distribution détectée.

## Vérifications exécutées

- `npm test --prefix backend`: OK, 5 tests.
- `npm run build --prefix frontend`: OK.
- `node --check` sur tous les fichiers backend: OK.
- Test navigateur Playwright login admin: OK, aucune erreur console.
- Scénario API complet wallet/duel/admin en MongoDB memory replica set: OK.

## Prêt production

Non.

Raison: le `.env` actuel pointe vers MongoDB standalone local. Pour argent réel, SKILL2CASH doit tourner sur MongoDB Atlas ou un replica set MongoDB, sinon les transactions financières ne peuvent pas être garanties.
