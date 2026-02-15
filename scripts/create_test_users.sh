#!/bin/bash
set -e

# Configuration
USER_POOL_NAME="BravebirdUsers"
REGION="us-east-1"
DEFAULT_PASSWORD="TempPassword123!"

echo ">>> Fetching User Pool ID for '$USER_POOL_NAME'..."
USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $REGION --query "UserPools[?contains(Name, '$USER_POOL_NAME')].id" --output text)

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" == "None" ]; then
    echo "ERROR: User Pool not found. Ensure backend deployment is complete."
    exit 1
fi

echo "Found User Pool ID: $USER_POOL_ID"

create_user() {
    EMAIL=$1
    HOSPITAL=$2
    
    echo "Creating user: $EMAIL ($HOSPITAL)..."
    
    aws cognito-idp admin-create-user \
        --user-pool-id $USER_POOL_ID \
        --username $EMAIL \
        --user-attributes Name="email",Value="$EMAIL" Name="email_verified",Value="true" Name="custom:hospital_id",Value="$HOSPITAL" \
        --temporary-password "$DEFAULT_PASSWORD" \
        --message-action SUPPRESS \
        --region $REGION
        
    aws cognito-idp admin-set-user-password \
        --user-pool-id $USER_POOL_ID \
        --username $EMAIL \
        --password "$DEFAULT_PASSWORD" \
        --permanent \
        --region $REGION
        
    echo "User $EMAIL created successfully."
}

echo "--- Creating Hospital Staff Users ---"

create_user "mercy_staff@bravebird.com" "Mercy General"
create_user "stjude_staff@bravebird.com" "St. Jude Medical"
create_user "cityhope_staff@bravebird.com" "City Hope Clinic"

echo "--- Done! ---"
echo "Login credentials:"
echo "Username: mercy_staff@bravebird.com / Password: $DEFAULT_PASSWORD"
echo "Username: stjude_staff@bravebird.com / Password: $DEFAULT_PASSWORD"
echo "Username: cityhope_staff@bravebird.com / Password: $DEFAULT_PASSWORD"
