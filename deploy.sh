#!/bin/bash

# Upapex WMS Deployment Script
# Usage: ./deploy.sh [environment]

ENVIRONMENT=${1:-production}
PROJECT_NAME="upapex-wms"
DEPLOY_DIR="/tmp/$PROJECT_NAME"

echo "🚀 Deploying Upapex WMS to $ENVIRONMENT"

# Create deployment directory
echo "📁 Creating deployment package..."
rm -rf $DEPLOY_DIR
mkdir -p $DEPLOY_DIR

# Copy essential files
echo "📦 Copying files..."
cp -r index.html apps shared docs $DEPLOY_DIR/
cp README.md ARCHITECTURE.md $DEPLOY_DIR/

# Copy development server for local deployment
if [ "$ENVIRONMENT" = "local" ]; then
    cp dev-server.py $DEPLOY_DIR/
    echo "🔧 Development server included"
fi

# Create .gitignore for deployment
echo "📝 Creating deployment .gitignore..."
cat > $DEPLOY_DIR/.gitignore << EOF
.DS_Store
*.log
node_modules/
.env
EOF

# Create deployment info
echo "📋 Creating deployment info..."
cat > $DEPLOY_DIR/DEPLOYMENT.md << EOF
# Deployment Information

**Environment:** $ENVIRONMENT
**Deployed:** $(date)
**Version:** 1.0.0

## Configuration Required

1. Update Google Sheets credentials in each app:
   - apps/dispatch/app.js
   - apps/inventory/app.js  
   - apps/track/app.js
   - apps/validate/app.js

2. Set your SPREADSHEET_ID and CLIENT_ID

## Local Development
\`\`\`bash
python3 dev-server.py
\`\`\`

## Static Hosting
Upload all files to your web server or static hosting service.
EOF

echo "✅ Deployment package created at: $DEPLOY_DIR"
echo "📂 Size: $(du -sh $DEPLOY_DIR | cut -f1)"

if [ "$ENVIRONMENT" = "local" ]; then
    echo "🌐 To start local server:"
    echo "   cd $DEPLOY_DIR && python3 dev-server.py"
else
    echo "📤 Upload contents of $DEPLOY_DIR to your web server"
fi
