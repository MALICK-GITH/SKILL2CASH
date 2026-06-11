# SKILL2CASH - Production Setup Guide

## ✅ System Status
All systems are fully connected and operational:
- **Backend API**: http://localhost:5000 ✓
- **Frontend**: http://localhost:5174 ✓
- **Database**: MongoDB (currently in memory mode for testing) ✓
- **Authentication**: Working ✓
- **Registration**: Working ✓

## 🚀 Production Deployment Steps

### 1. MongoDB Atlas Setup (Recommended - Free Tier)

1. **Create Account**
   - Go to https://www.mongodb.com/cloud/atlas
   - Sign up for free account

2. **Create Cluster**
   - Create new cluster (M0 free tier)
   - Choose region closest to your users
   - Wait for cluster creation (~5-10 minutes)

3. **Database Access**
   - Create database user with username/password
   - Whitelist IP addresses (0.0.0.0/0 for all, or specific IPs)

4. **Get Connection String**
   - Click "Connect" → "Connect your application"
   - Copy connection string
   - Format: `mongodb+srv://user:password@cluster.mongodb.net/skill2cash?retryWrites=true&w=majority`

### 2. Update Backend Configuration

Edit `backend/.env`:
```env
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/skill2cash?retryWrites=true&w=majority
JWT_SECRET=CHANGE_THIS_TO_A_VERY_LONG_RANDOM_SECRET
JWT_EXPIRES_IN=7d
CLIENT_URL=https://your-domain.com
PLATFORM_WALLET_ID=platform
```

### 3. Create Admin Account

Run from backend directory:
```bash
npm run create-admin
```

This will create:
 - An admin account from the `ADMIN_*` values set in `backend/.env`
 - **CHANGE THESE CREDENTIALS IMMEDIATELY AFTER FIRST LOGIN**

### 4. Update Frontend Configuration

Edit `frontend/.env`:
```env
VITE_API_URL=https://your-api-domain.com/api
```

### 5. Deploy Backend

Options:
- **Vercel/Render/Railway**: Deploy Node.js backend
- **VPS**: DigitalOcean, AWS, etc.
- Ensure MongoDB Atlas is accessible from deployment location

### 6. Deploy Frontend

Options:
- **Vercel**: Deploy React frontend (recommended)
- **Netlify**: Alternative for React
- Ensure CORS allows your frontend domain

### 7. Security Checklist

- [ ] Change JWT_SECRET to strong random value
- [ ] Change admin credentials immediately
- [ ] Enable HTTPS on both frontend and backend
- [ ] Configure MongoDB Atlas IP whitelist
- [ ] Set NODE_ENV=production
- [ ] Review CORS settings for production
- [ ] Enable rate limiting (already configured)
- [ ] Monitor logs for suspicious activity

### 8. Payment Configuration

Edit `backend/src/config/payments.js` to configure:
- Mobile Money accounts (Wave, Orange Money, etc.)
- Bank accounts
- Crypto wallets
- Payment processing fees

## 📊 Testing Results

Current test results (memory mode):
- ✅ API Health Check: 200 OK
- ✅ User Registration: 201 Created
- ✅ User Login: 200 OK
- ✅ Token Generation: Working
- ✅ CORS Configuration: Working

## 🔧 Switching from Memory to Production

1. Update `backend/.env` with MongoDB Atlas URI
2. Run `npm run create-admin` to create admin account
3. Change `package.json` dev script from `dev:memory` to `dev:mongo`
4. Restart servers with `npm run dev`

## 📝 Notes

- Demo data is disabled in production mode
- All user registrations will persist in MongoDB Atlas
- Admin panel accessible at `/admin` route for admin users
- WebSocket connections for real-time notifications
- OCR validation for eFootball screenshots
