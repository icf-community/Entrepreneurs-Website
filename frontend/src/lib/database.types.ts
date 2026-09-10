export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          notes: string | null
          target_id: string
          target_table: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          notes?: string | null
          target_id: string
          target_table: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          target_id?: string
          target_table?: string
        }
        Relationships: []
      }
      admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      blob_deletion_queue: {
        Row: {
          attempts: number
          blob_key: string
          container: string
          deleted_at: string | null
          enqueued_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
        }
        Insert: {
          attempts?: number
          blob_key: string
          container?: string
          deleted_at?: string | null
          enqueued_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
        }
        Update: {
          attempts?: number
          blob_key?: string
          container?: string
          deleted_at?: string | null
          enqueued_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
        }
        Relationships: []
      }
      cv_chunks: {
        Row: {
          chunk_type: Database["public"]["Enums"]["cv_chunk_type"]
          content: string
          content_tsv: unknown
          created_at: string
          cv_id: string
          embedding: string
          embedding_model: string
          id: string
          is_current: boolean
          member_id: string
        }
        Insert: {
          chunk_type: Database["public"]["Enums"]["cv_chunk_type"]
          content: string
          content_tsv?: unknown
          created_at?: string
          cv_id: string
          embedding: string
          embedding_model: string
          id?: string
          is_current?: boolean
          member_id: string
        }
        Update: {
          chunk_type?: Database["public"]["Enums"]["cv_chunk_type"]
          content?: string
          content_tsv?: unknown
          created_at?: string
          cv_id?: string
          embedding?: string
          embedding_model?: string
          id?: string
          is_current?: boolean
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_chunks_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "cvs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_chunks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_profiles: {
        Row: {
          created_at: string
          cv_id: string
          id: string
          is_current: boolean
          model_name: string
          profile: Json
          prompt_version: string
          summary: string
          summary_regenerated_at: string | null
          summary_source: string
        }
        Insert: {
          created_at?: string
          cv_id: string
          id?: string
          is_current?: boolean
          model_name: string
          profile: Json
          prompt_version: string
          summary: string
          summary_regenerated_at?: string | null
          summary_source?: string
        }
        Update: {
          created_at?: string
          cv_id?: string
          id?: string
          is_current?: boolean
          model_name?: string
          profile?: Json
          prompt_version?: string
          summary?: string
          summary_regenerated_at?: string | null
          summary_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_profiles_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: true
            referencedRelation: "cvs"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_skills: {
        Row: {
          canonical_name: string
          created_at: string
          embedding: string
          esco_uri: string | null
          id: string
        }
        Insert: {
          canonical_name: string
          created_at?: string
          embedding: string
          esco_uri?: string | null
          id?: string
        }
        Update: {
          canonical_name?: string
          created_at?: string
          embedding?: string
          esco_uri?: string | null
          id?: string
        }
        Relationships: []
      }
      cvs: {
        Row: {
          blob_key: string
          created_at: string
          failure_reason: string | null
          id: string
          is_current: boolean
          member_id: string
          mime_type: string | null
          original_filename: string | null
          raw_text: string | null
          raw_text_hash: string | null
          status: Database["public"]["Enums"]["cv_status"]
        }
        Insert: {
          blob_key: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          is_current?: boolean
          member_id: string
          mime_type?: string | null
          original_filename?: string | null
          raw_text?: string | null
          raw_text_hash?: string | null
          status?: Database["public"]["Enums"]["cv_status"]
        }
        Update: {
          blob_key?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          is_current?: boolean
          member_id?: string
          mime_type?: string | null
          original_filename?: string | null
          raw_text?: string | null
          raw_text_hash?: string | null
          status?: Database["public"]["Enums"]["cv_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cvs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_change_log: {
        Row: {
          changed_at: string
          id: string
          new_email: string
          old_email: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          id?: string
          new_email: string
          old_email: string
          user_id: string
        }
        Update: {
          changed_at?: string
          id?: string
          new_email?: string
          old_email?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          event_at: string
          id: string
          is_society_event: boolean
          location: string
          luma_link: string
          organiser_name: string
          posted_by: string
          rejected_reason: string | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          contact_email: string
          contact_email_visible?: boolean
          created_at?: string
          description: string
          event_at: string
          id?: string
          is_society_event?: boolean
          location: string
          luma_link: string
          organiser_name: string
          posted_by: string
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          contact_email?: string
          contact_email_visible?: boolean
          created_at?: string
          description?: string
          event_at?: string
          id?: string
          is_society_event?: boolean
          location?: string
          luma_link?: string
          organiser_name?: string
          posted_by?: string
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      github_connections: {
        Row: {
          access_token_encrypted: string
          available_repos: Json | null
          connected_at: string
          github_signal: Json | null
          github_user_id: number
          github_username: string
          last_scanned_at: string | null
          member_id: string
          scan_failure_reason: string | null
          scan_failure_transient: boolean
          scan_fingerprint: string | null
          scan_status: string
          showcase_nudged_at: string | null
          showcase_nudges_enabled: boolean
          showcase_repos: Json | null
          showcase_seen_repos: string[] | null
          showcase_selected_at: string | null
        }
        Insert: {
          access_token_encrypted: string
          available_repos?: Json | null
          connected_at?: string
          github_signal?: Json | null
          github_user_id: number
          github_username: string
          last_scanned_at?: string | null
          member_id: string
          scan_failure_reason?: string | null
          scan_failure_transient?: boolean
          scan_fingerprint?: string | null
          scan_status?: string
          showcase_nudged_at?: string | null
          showcase_nudges_enabled?: boolean
          showcase_repos?: Json | null
          showcase_seen_repos?: string[] | null
          showcase_selected_at?: string | null
        }
        Update: {
          access_token_encrypted?: string
          available_repos?: Json | null
          connected_at?: string
          github_signal?: Json | null
          github_user_id?: number
          github_username?: string
          last_scanned_at?: string | null
          member_id?: string
          scan_failure_reason?: string | null
          scan_failure_transient?: boolean
          scan_fingerprint?: string | null
          scan_status?: string
          showcase_nudged_at?: string | null
          showcase_nudges_enabled?: boolean
          showcase_repos?: Json | null
          showcase_seen_repos?: string[] | null
          showcase_selected_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "github_connections_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload: Json
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      listing_edits: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          previous: Json | null
          proposed: Json
          proposed_by: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["listing_edit_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          previous?: Json | null
          proposed: Json
          proposed_by: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["listing_edit_status"]
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          listing_kind?: Database["public"]["Enums"]["listing_event_kind"]
          previous?: Json | null
          proposed?: Json
          proposed_by?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["listing_edit_status"]
        }
        Relationships: []
      }
      listing_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["listing_event_type"]
          id: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          viewer_id: string
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["listing_event_type"]
          id?: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          viewer_id: string
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["listing_event_type"]
          id?: string
          listing_id?: string
          listing_kind?: Database["public"]["Enums"]["listing_event_kind"]
          viewer_id?: string
        }
        Relationships: []
      }
      member_skills: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          member_id: string
          raw_text: string
          skill_id: string | null
          source: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          member_id: string
          raw_text: string
          skill_id?: string | null
          source?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          member_id?: string
          raw_text?: string
          skill_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_skills_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "cv_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          application_deadline: string
          apply_method: Database["public"]["Enums"]["apply_method"]
          apply_url: string | null
          approved_at: string | null
          approved_by: string | null
          company: string
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          id: string
          location_text: string | null
          location_type: Database["public"]["Enums"]["location_type"]
          pay: string
          position_name: string
          posted_by: string
          rejected_reason: string | null
          start_month: number
          start_year: number
          status: Database["public"]["Enums"]["listing_status"]
          updated_at: string
        }
        Insert: {
          application_deadline: string
          apply_method: Database["public"]["Enums"]["apply_method"]
          apply_url?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company: string
          contact_email: string
          contact_email_visible?: boolean
          created_at?: string
          description: string
          id?: string
          location_text?: string | null
          location_type: Database["public"]["Enums"]["location_type"]
          pay: string
          position_name: string
          posted_by: string
          rejected_reason?: string | null
          start_month: number
          start_year: number
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Update: {
          application_deadline?: string
          apply_method?: Database["public"]["Enums"]["apply_method"]
          apply_url?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company?: string
          contact_email?: string
          contact_email_visible?: boolean
          created_at?: string
          description?: string
          id?: string
          location_text?: string | null
          location_type?: Database["public"]["Enums"]["location_type"]
          pay?: string
          position_name?: string
          posted_by?: string
          rejected_reason?: string | null
          start_month?: number
          start_year?: number
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_bookmarks: {
        Row: {
          created_at: string
          opportunity_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          opportunity_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          opportunity_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_bookmarks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_sectors: {
        Row: {
          opportunity_id: string
          sector_id: number
        }
        Insert: {
          opportunity_id: string
          sector_id: number
        }
        Update: {
          opportunity_id?: string
          sector_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_sectors_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_sectors_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_skills: {
        Row: {
          opportunity_id: string
          skill_id: number
        }
        Insert: {
          opportunity_id: string
          skill_id: number
        }
        Update: {
          opportunity_id?: string
          skill_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_skills_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_email: {
        Row: {
          attempts: number
          created_at: string
          html_body: string
          id: string
          last_attempted_at: string | null
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          provider_message_id: string | null
          reply_to: string | null
          sent_at: string | null
          subject: string
          text_body: string
          to_address: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          html_body: string
          id?: string
          last_attempted_at?: string | null
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          provider_message_id?: string | null
          reply_to?: string | null
          sent_at?: string | null
          subject: string
          text_body: string
          to_address: string
        }
        Update: {
          attempts?: number
          created_at?: string
          html_body?: string
          id?: string
          last_attempted_at?: string | null
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          provider_message_id?: string | null
          reply_to?: string | null
          sent_at?: string | null
          subject?: string
          text_body?: string
          to_address?: string
        }
        Relationships: []
      }
      post_images: {
        Row: {
          alt_text: string
          blob_key: string
          byte_size: number
          created_at: string
          height: number
          id: string
          position: number
          post_id: string
          width: number
        }
        Insert: {
          alt_text: string
          blob_key: string
          byte_size: number
          created_at?: string
          height: number
          id?: string
          position: number
          post_id: string
          width: number
        }
        Update: {
          alt_text?: string
          blob_key?: string
          byte_size?: number
          created_at?: string
          height?: number
          id?: string
          position?: number
          post_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_images_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_moderation_log: {
        Row: {
          admin_id: string | null
          author_email_snapshot: string | null
          author_id: string | null
          body_snapshot: string
          id: string
          image_count: number
          legal_hold: boolean
          post_id: string
          posted_at: string
          purge_after: string
          reason: string
          removed_at: string
          title_snapshot: string
        }
        Insert: {
          admin_id?: string | null
          author_email_snapshot?: string | null
          author_id?: string | null
          body_snapshot: string
          id?: string
          image_count?: number
          legal_hold?: boolean
          post_id: string
          posted_at: string
          purge_after?: string
          reason: string
          removed_at?: string
          title_snapshot: string
        }
        Update: {
          admin_id?: string | null
          author_email_snapshot?: string | null
          author_id?: string | null
          body_snapshot?: string
          id?: string
          image_count?: number
          legal_hold?: boolean
          post_id?: string
          posted_at?: string
          purge_after?: string
          reason?: string
          removed_at?: string
          title_snapshot?: string
        }
        Relationships: []
      }
      post_reports: {
        Row: {
          category: string
          created_at: string
          id: string
          post_id: string | null
          post_title_snapshot: string
          purge_after: string
          reason: string
          reporter_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          post_id?: string | null
          post_title_snapshot: string
          purge_after?: string
          reason: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          post_id?: string | null
          post_title_snapshot?: string
          purge_after?: string
          reason?: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          expires_at: string
          id: string
          kind: string
          source_id: string | null
          source_table: string | null
          title: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          source_id?: string | null
          source_table?: string | null
          title: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          source_id?: string | null
          source_table?: string | null
          title?: string
        }
        Relationships: []
      }
      profile_intents: {
        Row: {
          intent: string
          profile_id: string
          rank: number
        }
        Insert: {
          intent: string
          profile_id: string
          rank: number
        }
        Update: {
          intent?: string
          profile_id?: string
          rank?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_intents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_interests: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          label: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          label?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_interests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_sectors: {
        Row: {
          profile_id: string
          sector_id: number
        }
        Insert: {
          profile_id: string
          sector_id: number
        }
        Update: {
          profile_id?: string
          sector_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_sectors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_sectors_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_skills: {
        Row: {
          is_core: boolean
          profile_id: string
          skill_id: number
        }
        Insert: {
          is_core?: boolean
          profile_id: string
          skill_id: number
        }
        Update: {
          is_core?: boolean
          profile_id?: string
          skill_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_skills_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability_hours: string | null
          avatar_path: string | null
          bio: string | null
          bio_focus: string | null
          bio_hobbies: string | null
          committee_role: string | null
          course: string | null
          created_at: string
          current_focus: string | null
          cv_original_filename: string | null
          cv_parse_consent: boolean
          cv_parse_consent_at: string | null
          cv_path: string | null
          cv_suggested_skill_ids: number[] | null
          cv_uploaded_at: string | null
          first_name: string
          github_url: string | null
          grad_year: number | null
          id: string
          intake_completed_at: string | null
          intake_deferred_at: string | null
          intent_urgency: string | null
          is_committee: boolean
          linkedin_url: string | null
          portfolio_url: string | null
          preferred_name: string | null
          profile_version: number
          recruiting_status: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          surname: string
          updated_at: string
          venture_name: string | null
          venture_one_liner: string | null
          venture_stage: string | null
          venture_url: string | null
          working_on: string | null
        }
        Insert: {
          availability_hours?: string | null
          avatar_path?: string | null
          bio?: string | null
          bio_focus?: string | null
          bio_hobbies?: string | null
          committee_role?: string | null
          course?: string | null
          created_at?: string
          current_focus?: string | null
          cv_original_filename?: string | null
          cv_parse_consent?: boolean
          cv_parse_consent_at?: string | null
          cv_path?: string | null
          cv_suggested_skill_ids?: number[] | null
          cv_uploaded_at?: string | null
          first_name?: string
          github_url?: string | null
          grad_year?: number | null
          id: string
          intake_completed_at?: string | null
          intake_deferred_at?: string | null
          intent_urgency?: string | null
          is_committee?: boolean
          linkedin_url?: string | null
          portfolio_url?: string | null
          preferred_name?: string | null
          profile_version?: number
          recruiting_status?: string | null
          role: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          surname?: string
          updated_at?: string
          venture_name?: string | null
          venture_one_liner?: string | null
          venture_stage?: string | null
          venture_url?: string | null
          working_on?: string | null
        }
        Update: {
          availability_hours?: string | null
          avatar_path?: string | null
          bio?: string | null
          bio_focus?: string | null
          bio_hobbies?: string | null
          committee_role?: string | null
          course?: string | null
          created_at?: string
          current_focus?: string | null
          cv_original_filename?: string | null
          cv_parse_consent?: boolean
          cv_parse_consent_at?: string | null
          cv_path?: string | null
          cv_suggested_skill_ids?: number[] | null
          cv_uploaded_at?: string | null
          first_name?: string
          github_url?: string | null
          grad_year?: number | null
          id?: string
          intake_completed_at?: string | null
          intake_deferred_at?: string | null
          intent_urgency?: string | null
          is_committee?: boolean
          linkedin_url?: string | null
          portfolio_url?: string | null
          preferred_name?: string | null
          profile_version?: number
          recruiting_status?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          surname?: string
          updated_at?: string
          venture_name?: string | null
          venture_one_liner?: string | null
          venture_stage?: string | null
          venture_url?: string | null
          working_on?: string | null
        }
        Relationships: []
      }
      sectors: {
        Row: {
          created_at: string
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      skills: {
        Row: {
          aliases: string[]
          category: string | null
          created_at: string
          id: number
          name: string
        }
        Insert: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      upload_tickets: {
        Row: {
          blob_key: string
          consumed_at: string | null
          issued_at: string
          purpose: string
          user_id: string
        }
        Insert: {
          blob_key: string
          consumed_at?: string | null
          issued_at?: string
          purpose: string
          user_id: string
        }
        Update: {
          blob_key?: string
          consumed_at?: string | null
          issued_at?: string
          purpose?: string
          user_id?: string
        }
        Relationships: []
      }
      user_listing_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["user_action_type"]
          created_at: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          user_id: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["user_action_type"]
          created_at?: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          user_id: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["user_action_type"]
          created_at?: string
          listing_id?: string
          listing_kind?: Database["public"]["Enums"]["listing_event_kind"]
          user_id?: string
        }
        Relationships: []
      }
      vcs_grants: {
        Row: {
          amount: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          deadline: string | null
          description: string
          id: string
          kind: Database["public"]["Enums"]["vc_grant_kind"]
          link: string
          name: string
          posted_by: string
          rejected_reason: string | null
          stage: string | null
          status: Database["public"]["Enums"]["listing_status"]
          updated_at: string
        }
        Insert: {
          amount?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          deadline?: string | null
          description: string
          id?: string
          kind: Database["public"]["Enums"]["vc_grant_kind"]
          link: string
          name: string
          posted_by: string
          rejected_reason?: string | null
          stage?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Update: {
          amount?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          deadline?: string | null
          description?: string
          id?: string
          kind?: Database["public"]["Enums"]["vc_grant_kind"]
          link?: string
          name?: string
          posted_by?: string
          rejected_reason?: string | null
          stage?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vcs_grants_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _apply_intake_fields: {
        Args: {
          p_academic_interests: string[]
          p_availability_hours: string
          p_bio_focus: string
          p_bio_hobbies: string
          p_caller: string
          p_core_skill_ids: number[]
          p_current_focus: string
          p_hobbies: string[]
          p_intent_urgency: string
          p_intents: string[]
          p_preferred_name: string
          p_recruiting_status: string
          p_sector_ids: number[]
          p_skill_ids: number[]
          p_venture_name: string
          p_venture_one_liner: string
          p_venture_stage: string
          p_venture_url: string
        }
        Returns: undefined
      }
      admin_apply_listing_edit: {
        Args: { p_edit_id: string }
        Returns: {
          email: string
          first_name: string
          title: string
        }[]
      }
      admin_clear_avatar: { Args: { p_profile_id: string }; Returns: undefined }
      admin_create_event: {
        Args: {
          p_contact_email: string
          p_contact_email_visible: boolean
          p_description: string
          p_event_at: string
          p_is_society_event: boolean
          p_location: string
          p_luma_link: string
          p_organiser_name: string
          p_title: string
        }
        Returns: string
      }
      admin_create_opportunity: {
        Args: {
          p_application_deadline: string
          p_apply_method: Database["public"]["Enums"]["apply_method"]
          p_apply_url: string
          p_company: string
          p_contact_email: string
          p_contact_email_visible: boolean
          p_description: string
          p_location_text: string
          p_location_type: Database["public"]["Enums"]["location_type"]
          p_pay: string
          p_position_name: string
          p_sector_ids: number[]
          p_skill_ids: number[]
          p_start_month: number
          p_start_year: number
        }
        Returns: string
      }
      admin_create_vc_grant: {
        Args: {
          p_amount: string
          p_deadline: string
          p_description: string
          p_kind: Database["public"]["Enums"]["vc_grant_kind"]
          p_link: string
          p_name: string
          p_stage: string
        }
        Returns: string
      }
      admin_delete_graduates: {
        Args: { p_cutoff_year: number }
        Returns: {
          email: string
          first_name: string
          user_id: string
        }[]
      }
      admin_delete_post: {
        Args: { p_post_id: string; p_reason: string }
        Returns: {
          email: string
          first_name: string
          posted_at: string
          title: string
        }[]
      }
      admin_delete_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: {
          email: string
          first_name: string
        }[]
      }
      admin_get_cv_info: {
        Args: { p_profile_id: string }
        Returns: {
          cv_original_filename: string
          cv_path: string
          cv_uploaded_at: string
        }[]
      }
      admin_get_signup_emails: {
        Args: { p_user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      admin_list_listing_edits: {
        Args: never
        Returns: {
          created_at: string
          current_values: Json
          id: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          listing_title: string
          proposed: Json
          proposed_by: string
          proposed_by_name: string
        }[]
      }
      admin_list_pending_profiles: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          bio: string
          course: string
          created_at: string
          email: string
          first_name: string
          github_url: string
          grad_year: number
          id: string
          linkedin_url: string
          portfolio_url: string
          role: Database["public"]["Enums"]["user_role"]
          sector_names: string[]
          skill_names: string[]
          surname: string
          total_count: number
          working_on: string
        }[]
      }
      admin_list_post_reports: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          author_first_name: string
          author_id: string
          author_surname: string
          category: string
          created_at: string
          id: string
          post_id: string
          post_still_exists: boolean
          post_title_snapshot: string
          reason: string
          reporter_first_name: string
          reporter_surname: string
          resolution_note: string
          resolved_at: string
          status: string
          total_count: number
        }[]
      }
      admin_list_profiles: {
        Args: {
          p_courses?: string[]
          p_grad_max?: number
          p_grad_min?: number
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_roles?: string[]
          p_sectors?: string[]
          p_skills?: string[]
          p_statuses?: string[]
        }
        Returns: {
          committee_role: string
          course: string
          created_at: string
          email: string
          first_name: string
          grad_year: number
          id: string
          is_committee: boolean
          role: Database["public"]["Enums"]["user_role"]
          sector_names: string[]
          skill_names: string[]
          status: Database["public"]["Enums"]["user_status"]
          surname: string
          total_count: number
        }[]
      }
      admin_log_cv_access: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      admin_outbound_email_stats: {
        Args: never
        Returns: {
          failed: number
          oldest_pending_age_seconds: number
          pending: number
          sent_today: number
        }[]
      }
      admin_profile_facets: {
        Args: never
        Returns: {
          courses: string[]
          grad_max: number
          grad_min: number
          sectors: string[]
          skills: string[]
          total: number
        }[]
      }
      admin_reject_listing_edit: {
        Args: { p_edit_id: string; p_reason: string }
        Returns: {
          email: string
          first_name: string
          title: string
        }[]
      }
      admin_resolve_post_report: {
        Args: { p_note?: string; p_report_id: string; p_status: string }
        Returns: {
          email: string
          first_name: string
          post_title: string
        }[]
      }
      admin_set_committee: {
        Args: {
          p_committee_role?: string
          p_is_committee: boolean
          p_member_id: string
        }
        Returns: undefined
      }
      admin_update_listing: {
        Args: {
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
          p_listing_id: string
          p_payload: Json
        }
        Returns: undefined
      }
      apply_listing_edit_payload: {
        Args: {
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
          p_listing_id: string
          p_payload: Json
        }
        Returns: undefined
      }
      approve_event: {
        Args: { p_event_id: string; p_notes?: string }
        Returns: undefined
      }
      approve_opportunity: {
        Args: { p_notes?: string; p_opportunity_id: string }
        Returns: undefined
      }
      approve_user: {
        Args: { p_notes?: string; p_user_id: string }
        Returns: {
          email: string
          first_name: string
        }[]
      }
      approve_vc_grant: {
        Args: { p_id: string; p_notes?: string }
        Returns: undefined
      }
      claim_blob_deletion_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          blob_key: string
          container: string
          id: string
          max_attempts: number
        }[]
      }
      claim_outbound_email_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          html_body: string
          id: string
          max_attempts: number
          reply_to: string
          subject: string
          text_body: string
          to_address: string
        }[]
      }
      confirm_avatar_upload: {
        Args: { p_blob_key: string }
        Returns: undefined
      }
      confirm_cv_upload: {
        Args: { p_blob_key: string; p_consent: boolean; p_filename: string }
        Returns: undefined
      }
      confirm_github_connected: {
        Args: {
          p_access_token: string
          p_encryption_key: string
          p_github_user_id: number
          p_github_username: string
        }
        Returns: undefined
      }
      create_post: {
        Args: { p_body: string; p_images?: Json; p_title: string }
        Returns: {
          author_first_name: string
          author_role: Database["public"]["Enums"]["user_role"]
          author_surname: string
          created_at: string
          expires_at: string
          id: string
        }[]
      }
      create_system_post: {
        Args: {
          p_author_id: string
          p_body: string
          p_source_id: string
          p_source_table: string
          p_title: string
        }
        Returns: undefined
      }
      cron_drain_blob_deletions: { Args: never; Returns: undefined }
      cron_drain_outbound_email: { Args: never; Returns: undefined }
      cron_github_showcase_nudge: { Args: never; Returns: undefined }
      defer_intake: { Args: never; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      delete_my_post: { Args: { p_post_id: string }; Returns: undefined }
      disconnect_github: { Args: never; Returns: undefined }
      dismiss_my_github_showcase_prompt: { Args: never; Returns: undefined }
      due_github_showcase_nudges: {
        Args: { p_limit?: number }
        Returns: {
          email: string
          first_name: string
          member_id: string
          new_repos: string[]
        }[]
      }
      enqueue_github_rescans: { Args: never; Returns: number }
      enqueue_outbound_email: {
        Args: {
          p_html: string
          p_reply_to?: string
          p_subject: string
          p_text: string
          p_to: string
        }
        Returns: string
      }
      enqueue_outbound_email_bulk: { Args: { p_rows: Json }; Returns: number }
      expire_events: { Args: never; Returns: number }
      expire_opportunities: { Args: never; Returns: number }
      expire_vcs_grants: { Args: never; Returns: number }
      get_event_for_edit: {
        Args: { p_id: string }
        Returns: {
          contact_email: string
          contact_email_visible: boolean
          description: string
          event_at: string
          id: string
          location: string
          luma_link: string
          organiser_name: string
          posted_by: string
          status: Database["public"]["Enums"]["listing_status"]
          title: string
        }[]
      }
      get_my_activity: {
        Args: never
        Returns: {
          action_type: Database["public"]["Enums"]["user_action_type"]
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          marked_at: string
          occurs_at: string
          status: string
          subtitle: string
          title: string
          url: string
        }[]
      }
      get_my_cv_info: {
        Args: never
        Returns: {
          cv_original_filename: string
          cv_parse_consent: boolean
          cv_path: string
          cv_suggested_skill_ids: number[]
          cv_uploaded_at: string
        }[]
      }
      get_my_cv_profile: {
        Args: never
        Returns: {
          skills: string[]
          summary: string
        }[]
      }
      get_my_cv_status: {
        Args: never
        Returns: {
          failure_reason: string
          status: Database["public"]["Enums"]["cv_status"]
        }[]
      }
      get_my_github_showcase: {
        Args: never
        Returns: {
          available_repos: Json
          seen_repos: string[]
          showcase_repos: Json
          suggested_repos: Json
          themes: Json
        }[]
      }
      get_my_github_status: {
        Args: never
        Returns: {
          github_username: string
          has_showcase: boolean
          has_signal: boolean
          needs_showcase_review: boolean
          scan_failure_reason: string
          scan_status: string
        }[]
      }
      get_my_listing_actions: {
        Args: never
        Returns: {
          action_type: Database["public"]["Enums"]["user_action_type"]
          created_at: string
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
        }[]
      }
      get_my_listing_stats: {
        Args: never
        Returns: {
          click_count: number
          listing_id: string
          listing_kind: Database["public"]["Enums"]["listing_event_kind"]
          view_count: number
        }[]
      }
      get_my_pending_listing_edit: {
        Args: {
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
          p_listing_id: string
        }
        Returns: {
          created_at: string
          current_values: Json
          id: string
          proposed: Json
        }[]
      }
      get_opportunity_for_edit: {
        Args: { p_id: string }
        Returns: {
          application_deadline: string
          apply_method: Database["public"]["Enums"]["apply_method"]
          apply_url: string
          company: string
          contact_email: string
          contact_email_visible: boolean
          description: string
          id: string
          location_text: string
          location_type: Database["public"]["Enums"]["location_type"]
          pay: string
          position_name: string
          posted_by: string
          start_month: number
          start_year: number
          status: Database["public"]["Enums"]["listing_status"]
        }[]
      }
      get_post_like_counts: {
        Args: { p_post_ids: string[] }
        Returns: {
          id: string
          like_count: number
          liked_by_me: boolean
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_approved: { Args: never; Returns: boolean }
      is_imperial_email: { Args: { p_email: string }; Returns: boolean }
      issue_upload_ticket: { Args: { p_purpose?: string }; Returns: string }
      list_approved_events: {
        Args: never
        Returns: {
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          event_at: string
          id: string
          is_society_event: boolean
          location: string
          luma_link: string
          organiser_name: string
          posted_by: string
          poster_first_name: string
          poster_linkedin_url: string
          poster_surname: string
          title: string
        }[]
      }
      list_approved_opportunities: {
        Args: never
        Returns: {
          application_deadline: string
          apply_method: Database["public"]["Enums"]["apply_method"]
          apply_url: string
          company: string
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          id: string
          location_text: string
          location_type: Database["public"]["Enums"]["location_type"]
          pay: string
          position_name: string
          posted_by: string
          poster_first_name: string
          poster_linkedin_url: string
          poster_surname: string
          sector_names: string[]
          skill_names: string[]
          start_month: number
          start_year: number
        }[]
      }
      list_approved_vcs_grants: {
        Args: {
          p_from?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_to?: string
        }
        Returns: {
          amount: string
          created_at: string
          deadline: string
          description: string
          id: string
          kind: Database["public"]["Enums"]["vc_grant_kind"]
          link: string
          name: string
          posted_by: string
          poster_first_name: string
          poster_surname: string
          stage: string
          total_count: number
        }[]
      }
      list_committee_cards: {
        Args: never
        Returns: {
          avatar_path: string
          bio_focus: string
          bio_hobbies: string
          committee_role: string
          course: string
          first_name: string
          grad_year: number
          id: string
          role: Database["public"]["Enums"]["user_role"]
          sector_names: string[]
          skill_names: string[]
          surname: string
        }[]
      }
      list_community_feed: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
        }
        Returns: {
          author_first_name: string
          author_id: string
          author_role: Database["public"]["Enums"]["user_role"]
          author_surname: string
          body: string
          created_at: string
          expires_at: string
          id: string
          images: Json
          kind: string
          like_count: number
          liked_by_me: boolean
          source_id: string
          source_table: string
          title: string
        }[]
      }
      list_directory_cards: {
        Args: {
          p_courses?: string[]
          p_grad_max?: number
          p_grad_min?: number
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_roles?: string[]
          p_sectors?: string[]
          p_skills?: string[]
          p_sort?: string
        }
        Returns: {
          avatar_path: string
          bio_focus: string
          bio_hobbies: string
          course: string
          created_at: string
          first_name: string
          grad_year: number
          id: string
          role: Database["public"]["Enums"]["user_role"]
          sector_names: string[]
          skill_names: string[]
          surname: string
          total_count: number
        }[]
      }
      list_directory_facets: {
        Args: never
        Returns: {
          courses: string[]
          grad_max: number
          grad_min: number
          sectors: string[]
          skills: string[]
          total: number
        }[]
      }
      list_my_bookmarked_opportunities: {
        Args: never
        Returns: {
          application_deadline: string
          apply_method: Database["public"]["Enums"]["apply_method"]
          apply_url: string
          bookmarked_at: string
          company: string
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          id: string
          location_text: string
          location_type: Database["public"]["Enums"]["location_type"]
          pay: string
          position_name: string
          posted_by: string
          poster_first_name: string
          poster_linkedin_url: string
          poster_surname: string
          sector_names: string[]
          skill_names: string[]
          start_month: number
          start_year: number
        }[]
      }
      list_my_posts: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
        }
        Returns: {
          body: string
          created_at: string
          expires_at: string
          id: string
          images: Json
          like_count: number
          title: string
        }[]
      }
      list_pending_events_admin: {
        Args: never
        Returns: {
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          event_at: string
          id: string
          location: string
          luma_link: string
          organiser_name: string
          posted_by: string
          poster_first_name: string
          poster_linkedin_url: string
          poster_surname: string
          title: string
        }[]
      }
      list_pending_opportunities_admin: {
        Args: never
        Returns: {
          application_deadline: string
          apply_method: Database["public"]["Enums"]["apply_method"]
          apply_url: string
          company: string
          contact_email: string
          contact_email_visible: boolean
          created_at: string
          description: string
          id: string
          location_text: string
          location_type: Database["public"]["Enums"]["location_type"]
          pay: string
          position_name: string
          posted_by: string
          poster_first_name: string
          poster_linkedin_url: string
          poster_surname: string
          sector_names: string[]
          skill_names: string[]
          start_month: number
          start_year: number
        }[]
      }
      listing_has_pending_edit: {
        Args: {
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
          p_listing_id: string
        }
        Returns: boolean
      }
      listing_snapshot: {
        Args: {
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
          p_listing_id: string
        }
        Returns: Json
      }
      listing_table_name: {
        Args: { p_kind: Database["public"]["Enums"]["listing_event_kind"] }
        Returns: string
      }
      llm_job_budget_available: { Args: { p_member: string }; Returns: boolean }
      mark_github_showcase_nudged: {
        Args: { p_member_ids: string[] }
        Returns: undefined
      }
      mark_listing_action: {
        Args: {
          p_action: Database["public"]["Enums"]["user_action_type"]
          p_id: string
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
        }
        Returns: undefined
      }
      posting_enabled: { Args: never; Returns: boolean }
      purge_expired_posts: { Args: never; Returns: number }
      purge_moderation_records: { Args: never; Returns: number }
      purge_rejected_listings: { Args: never; Returns: number }
      purge_stale_upload_tickets: { Args: never; Returns: number }
      reap_stalled_jobs: { Args: never; Returns: number }
      record_listing_event: {
        Args: {
          p_event_type: Database["public"]["Enums"]["listing_event_type"]
          p_id: string
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
        }
        Returns: undefined
      }
      reject_event: {
        Args: { p_event_id: string; p_reason: string }
        Returns: {
          email: string
          first_name: string
          title: string
        }[]
      }
      reject_opportunity: {
        Args: { p_opportunity_id: string; p_reason: string }
        Returns: {
          email: string
          first_name: string
          title: string
        }[]
      }
      reject_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: {
          email: string
          first_name: string
        }[]
      }
      reject_vc_grant: {
        Args: { p_id: string; p_reason: string }
        Returns: {
          email: string
          first_name: string
          title: string
        }[]
      }
      remove_my_avatar: { Args: never; Returns: undefined }
      remove_my_cv: { Args: never; Returns: undefined }
      report_post: {
        Args: { p_category: string; p_post_id: string; p_reason: string }
        Returns: {
          filed: boolean
          post_title: string
        }[]
      }
      set_cv_suggested_skills: {
        Args: { p_skill_ids: number[] }
        Returns: undefined
      }
      set_my_affiliation: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: undefined
      }
      set_my_github_nudges: { Args: { p_enabled: boolean }; Returns: undefined }
      set_my_github_showcase: { Args: { p_picks: Json }; Returns: undefined }
      set_my_linkedin: { Args: { p_linkedin_url: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stage_listing_edit: {
        Args: {
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
          p_listing_id: string
          p_payload: Json
        }
        Returns: undefined
      }
      submit_event: {
        Args: {
          p_contact_email: string
          p_contact_email_visible: boolean
          p_description: string
          p_event_at: string
          p_location: string
          p_luma_link: string
          p_organiser_name: string
          p_title: string
        }
        Returns: string
      }
      submit_intake: {
        Args: {
          p_academic_interests?: string[]
          p_availability_hours?: string
          p_bio_focus: string
          p_bio_hobbies: string
          p_core_skill_ids?: number[]
          p_current_focus?: string
          p_hobbies?: string[]
          p_intent_urgency?: string
          p_intents?: string[]
          p_preferred_name: string
          p_recruiting_status?: string
          p_sector_ids?: number[]
          p_skill_ids?: number[]
          p_venture_name?: string
          p_venture_one_liner?: string
          p_venture_stage?: string
          p_venture_url?: string
        }
        Returns: undefined
      }
      submit_onboarding: {
        Args: {
          p_course: string
          p_github_url: string
          p_grad_year: number
          p_linkedin_url: string
          p_portfolio_url: string
        }
        Returns: undefined
      }
      submit_opportunity: {
        Args: {
          p_application_deadline: string
          p_apply_method: Database["public"]["Enums"]["apply_method"]
          p_apply_url: string
          p_company: string
          p_contact_email: string
          p_contact_email_visible: boolean
          p_description: string
          p_location_text: string
          p_location_type: Database["public"]["Enums"]["location_type"]
          p_pay: string
          p_position_name: string
          p_sector_ids: number[]
          p_skill_ids: number[]
          p_start_month: number
          p_start_year: number
        }
        Returns: string
      }
      submit_vc_grant: {
        Args: {
          p_amount: string
          p_deadline: string
          p_description: string
          p_kind: Database["public"]["Enums"]["vc_grant_kind"]
          p_link: string
          p_name: string
          p_stage: string
        }
        Returns: string
      }
      toggle_post_like: {
        Args: { p_post_id: string }
        Returns: {
          like_count: number
          liked: boolean
        }[]
      }
      unmark_listing_action: {
        Args: {
          p_action: Database["public"]["Enums"]["user_action_type"]
          p_id: string
          p_kind: Database["public"]["Enums"]["listing_event_kind"]
        }
        Returns: undefined
      }
      update_cv_currency: { Args: { p_cv_id: string }; Returns: undefined }
      update_event: {
        Args: {
          p_contact_email: string
          p_contact_email_visible: boolean
          p_description: string
          p_event_at: string
          p_id: string
          p_location: string
          p_luma_link: string
          p_organiser_name: string
          p_title: string
        }
        Returns: undefined
      }
      update_opportunity: {
        Args: {
          p_application_deadline: string
          p_apply_method: Database["public"]["Enums"]["apply_method"]
          p_apply_url: string
          p_company: string
          p_contact_email: string
          p_contact_email_visible: boolean
          p_description: string
          p_id: string
          p_location_text: string
          p_location_type: Database["public"]["Enums"]["location_type"]
          p_pay: string
          p_position_name: string
          p_sector_ids: number[]
          p_skill_ids: number[]
          p_start_month: number
          p_start_year: number
        }
        Returns: undefined
      }
      update_profile: {
        Args: {
          p_academic_interests?: string[]
          p_availability_hours?: string
          p_bio_focus?: string
          p_bio_hobbies?: string
          p_core_skill_ids?: number[]
          p_course: string
          p_current_focus?: string
          p_first_name: string
          p_github_url: string
          p_grad_year: number
          p_hobbies?: string[]
          p_intent_urgency?: string
          p_intents?: string[]
          p_linkedin_url: string
          p_portfolio_url: string
          p_preferred_name?: string
          p_recruiting_status?: string
          p_sector_ids?: number[]
          p_skill_ids?: number[]
          p_surname: string
          p_venture_name?: string
          p_venture_one_liner?: string
          p_venture_stage?: string
          p_venture_url?: string
        }
        Returns: undefined
      }
      update_vc_grant: {
        Args: {
          p_amount: string
          p_deadline: string
          p_description: string
          p_id: string
          p_kind: Database["public"]["Enums"]["vc_grant_kind"]
          p_link: string
          p_name: string
          p_stage: string
        }
        Returns: undefined
      }
    }
    Enums: {
      apply_method: "email" | "link"
      cv_chunk_type: "role" | "project" | "education" | "skills" | "summary"
      cv_status:
        | "pending"
        | "extracting"
        | "embedding"
        | "ready"
        | "failed"
        | "flagged"
      job_status: "pending" | "running" | "done" | "failed" | "dead"
      listing_edit_status: "pending" | "applied" | "rejected" | "discarded"
      listing_event_kind: "opportunity" | "event" | "vc_grant"
      listing_event_type:
        | "expand"
        | "apply_click"
        | "contact_click"
        | "external_click"
      listing_status: "pending" | "approved" | "rejected" | "expired"
      location_type: "remote" | "hybrid" | "onsite"
      user_action_type: "applied" | "going"
      user_role:
        | "student"
        | "alum"
        | "recent_grad"
        | "mentor"
        | "angel"
        | "staff_faculty"
      user_status:
        | "pending_onboarding"
        | "pending_review"
        | "approved"
        | "rejected"
      vc_grant_kind: "vc" | "grant"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      apply_method: ["email", "link"],
      cv_chunk_type: ["role", "project", "education", "skills", "summary"],
      cv_status: [
        "pending",
        "extracting",
        "embedding",
        "ready",
        "failed",
        "flagged",
      ],
      job_status: ["pending", "running", "done", "failed", "dead"],
      listing_edit_status: ["pending", "applied", "rejected", "discarded"],
      listing_event_kind: ["opportunity", "event", "vc_grant"],
      listing_event_type: [
        "expand",
        "apply_click",
        "contact_click",
        "external_click",
      ],
      listing_status: ["pending", "approved", "rejected", "expired"],
      location_type: ["remote", "hybrid", "onsite"],
      user_action_type: ["applied", "going"],
      user_role: [
        "student",
        "alum",
        "recent_grad",
        "mentor",
        "angel",
        "staff_faculty",
      ],
      user_status: [
        "pending_onboarding",
        "pending_review",
        "approved",
        "rejected",
      ],
      vc_grant_kind: ["vc", "grant"],
    },
  },
} as const

