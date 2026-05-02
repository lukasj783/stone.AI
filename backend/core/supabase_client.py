import os
from supabase import create_client, Client
from core.config import get_settings

def get_supabase_client() -> Client | None:
    settings = get_settings()
    url = settings.supabase_url
    key = settings.supabase_service_role_key
    
    if not url or not key:
        return None
        
    return create_client(url, key)
