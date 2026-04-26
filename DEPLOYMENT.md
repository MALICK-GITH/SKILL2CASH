# 🚀 SKILL2CASH - Guide de Déploiement Production

## 📋 Pré-requis

- MongoDB Atlas cluster configuré
- Serveur VPS (Ubuntu/Debian) ou compte Render
- Node.js 18+ installé
- Git installé
- Domaine configuré (optionnel)

---

## 🔐 Configuration Sécurité

### 1. Variables d'environnement

Créer le fichier `.env` dans le backend:

```bash
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/skill2cash?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<générer avec: openssl rand -base64 64>
JWT_EXPIRES_IN=7d
CLIENT_URL=https://votre-domaine.com
PLATFORM_WALLET_ID=platform
```

**Générer JWT_SECRET sécurisé:**
```bash
openssl rand -base64 64
```

---

## 🗄️ MongoDB Atlas Configuration

### Étapes:

1. **Créer un cluster Atlas**
   - Aller sur https://www.mongodb.com/cloud/atlas
   - Créer un compte gratuit
   - Créer un cluster (M0 Free Tier ou supérieur)

2. **Configurer l'accès réseau**
   - Network Access → Add IP Address
   - Ajouter l'IP du serveur ou 0.0.0.0/0 (toutes les IPs)
   - Pour VPS: ajouter l'IP spécifique du serveur

3. **Créer un utilisateur database**
   - Database Access → Create User
   - Username: skill2cash_user
   - Password: mot de passe fort
   - Role: Read and write to any database

4. **Obtenir la connection string**
   - Cluster → Connect → Connect your application
   - Copier la connection string
   - Remplacer `<password>` par le mot de passe utilisateur

---

## 👤 Créer le compte Admin

### Via le script:

```bash
cd backend
npm run create-admin
```

**Credentiels par défaut (CHANGER IMMÉDIATEMENT):**
- Email: admin@skill2cash.com
- Password: Skill2Cash@2024!Admin

**OU modifier dans `src/seed/createAdmin.js` avant exécution.**

---

## 🖥️ Déploiement Backend (VPS)

### 1. Cloner le projet

```bash
git clone <votre-repo>
cd QUIPERD\ S/backend
```

### 2. Installer les dépendances

```bash
npm install --production
```

### 3. Configurer les variables

```bash
nano .env
# Coller les variables d'environnement
```

### 4. Tester en local

```bash
npm start
```

### 5. Installer PM2 (Process Manager)

```bash
npm install -g pm2
```

### 6. Démarrer avec PM2

```bash
pm2 start src/server.js --name skill2cash-api
pm2 save
pm2 startup
```

### 7. Configurer Nginx (Reverse Proxy)

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 8. Configurer SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d votre-domaine.com
```

---

## 🌐 Déploiement Frontend (VPS)

### 1. Build du frontend

```bash
cd frontend
npm install
npm run build
```

### 2. Déployer le build

```bash
# Copier le dossier dist vers /var/www/skill2cash
sudo cp -r dist/* /var/www/skill2cash/
```

### 3. Configurer Nginx pour le frontend

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    root /var/www/skill2cash;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## ☁️ Déploiement Render (Alternative)

### Backend sur Render

1. **Créer un compte Render**
2. **Connecter le repo GitHub**
3. **Créer un Web Service**
   - Name: skill2cash-api
   - Environment: Node
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
4. **Ajouter les variables d'environnement**
   - Dans Render Dashboard → Environment
   - Ajouter toutes les variables du .env

### Frontend sur Render

1. **Créer un Static Site**
   - Name: skill2cash-frontend
   - Build Command: `cd frontend && npm install && npm run build`
   - Publish Directory: `frontend/dist`
2. **Ajouter les variables d'environnement**
   - VITE_API_URL=https://skill2cash-api.onrender.com

---

## 🔍 Vérifications Post-Déploiement

### 1. Vérifier le backend

```bash
curl https://votre-domaine.com/api
```

### 2. Vérifier la connexion MongoDB

- Vérifier les logs du serveur
- S'assurer que "MongoDB connected" apparaît

### 3. Tester l'inscription

- Créer un compte utilisateur
- Vérifier que le wallet est créé

### 4. Tester le login admin

- Se connecter avec le compte admin
- Vérifier l'accès au panel admin

### 5. Tester un dépôt

- Faire un dépôt test
- Vérifier l'approbation admin

---

## 📊 Monitoring

### Logs PM2

```bash
pm2 logs skill2cash-api
pm2 monit
```

### Redémarrer le service

```bash
pm2 restart skill2cash-api
```

---

## 🔒 Sécurité Additionnelle

### 1. Firewall UFW

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### 2. Fail2Ban (Anti-brute force)

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

### 3. Mises à jour automatiques

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 📝 Checklist Déploiement

- [ ] MongoDB Atlas configuré
- [ ] Variables d'environnement définies
- [ ] JWT_SECRET sécurisé généré
- [ ] Compte admin créé
- [ ] Backend déployé et fonctionnel
- [ ] Frontend build et déployé
- [ ] Nginx configuré
- [ ] SSL configuré
- [ ] Tests fonctionnels passés
- [ ] Monitoring configuré

---

## 🆘 Support

En cas de problème:
1. Vérifier les logs: `pm2 logs`
2. Vérifier la connexion MongoDB
3. Vérifier les variables d'environnement
4. Vérifier les ports ouverts

---

**SIGNÉ:** SOLITAIRE HACK
