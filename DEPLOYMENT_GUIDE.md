# 🚀 Upapex WMS Deployment Guide

## Quick Start

### Local Development
```bash
./deploy.sh local
cd /tmp/upapex-wms
python3 dev-server.py
```

### Production Deployment
```bash
./deploy.sh production
# Upload /tmp/upapex-wms contents to your web server
```

## Deployment Options

### 1. Static Hosting (Recommended)
- **Vercel**, **Netlify**, **GitHub Pages**
- Upload all files except `.DS_Store`
- No server configuration needed

### 2. Traditional Web Server
- Apache/Nginx
- Upload files to web root
- Ensure HTTPS for Google OAuth

### 3. Cloud Storage
- **AWS S3** + CloudFront
- **Google Cloud Storage**
- **Azure Blob Storage**

## Pre-Deployment Checklist

- [ ] Update Google Sheets credentials in all apps
- [ ] Test OAuth 2.0 configuration
- [ ] Verify SPREADSHEET_ID permissions
- [ ] Enable HTTPS on production
- [ ] Test all 4 applications

## Environment Variables

Each app needs these configurations:
```javascript
const CONFIG = {
    SPREADSHEET_ID: 'your_sheet_id',
    SHEET_NAME: 'sheet_name',
    CLIENT_ID: 'your_client_id.apps.googleusercontent.com'
};
```

## Post-Deployment

1. Test authentication flow
2. Verify Google Sheets connectivity
3. Test barcode scanning functionality
4. Check responsive design
5. Validate all 4 modules work correctly
