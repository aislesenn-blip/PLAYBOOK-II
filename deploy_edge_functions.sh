#!/bin/bash
echo "Deploying Playbook Enterprise Edge Functions to Supabase..."
echo "Ensure you have logged in via 'supabase login' and linked your project via 'supabase link'."

supabase functions deploy format-scheme --no-verify-jwt
supabase functions deploy grade-exams --no-verify-jwt
supabase functions deploy auto-grade-single --no-verify-jwt
supabase functions deploy auto-grade-appeal --no-verify-jwt

echo "Deployment complete! Your serverless grading engine is now live."
