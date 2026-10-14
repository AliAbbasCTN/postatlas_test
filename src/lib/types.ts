
export type OrgRole =
  | "owner"
  | "seo_manager"
  | "seo_specialist"
  | "content_manager"
  | "viewer";

export type PlatformRole =
  | "user"
  | "publisher"
  | "admin"
  | "super_admin";

export type WebsiteStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "suspended";

export type OrderType =
  | "guest_post"
  | "link_insertion";

export type OrderStatus =
  | "PAYMENT_PENDING"
  | "PAYMENT_UNDER_REVIEW"
  | "PAID"
  | "CONTENT_SUBMITTED"
  | "PENDING_PUBLISHER"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "PUBLISHED"
  | "VERIFICATION_PENDING"
  | "VERIFIED"
  | "MONITORING"
  | "ISSUE_DETECTED"
  | "REPLACEMENT_REQUESTED"
  | "COMPLETED"
  | "PUBLISHER_REJECTED"
  | "CANCELLED"
  | "DISPUTED";

export type PaymentStatus =
  | "PAYMENT_UNDER_REVIEW"
  | "PAID"
  | "PAYMENT_REJECTED";

export type ArticleStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "PUBLISHED"
  | "UNPUBLISHED";




export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      article_categories: {
        Row: {
          id: string
          name: string
          slug: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      articles: {
        Row: {
          author_name: string | null
          canonical_url: string | null
          category_id: string | null
          content: string
          excerpt: string | null
          featured_image: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          published_at: string | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          canonical_url?: string | null
          category_id?: string | null
          content: string
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          canonical_url?: string | null
          category_id?: string | null
          content?: string
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "article_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip: unknown
          metadata: Json | null
          organization_id: string | null
          resource_id: string | null
          resource_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          metadata?: Json | null
          organization_id?: string | null
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          metadata?: Json | null
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backlink_checks: {
        Row: {
          anchor_matched: boolean | null
          attribute: string | null
          checked_at: string
          http_status: number | null
          id: string
          link_found: boolean | null
          placement_id: string
          result: string
        }
        Insert: {
          anchor_matched?: boolean | null
          attribute?: string | null
          checked_at?: string
          http_status?: number | null
          id?: string
          link_found?: boolean | null
          placement_id: string
          result: string
        }
        Update: {
          anchor_matched?: boolean | null
          attribute?: string | null
          checked_at?: string
          http_status?: number | null
          id?: string
          link_found?: boolean | null
          placement_id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlink_checks_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "published_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      backlink_monitoring_events: {
        Row: {
          created_at: string
          detail: Json | null
          event_type: string
          id: string
          placement_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          event_type: string
          id?: string
          placement_id: string
        }
        Update: {
          created_at?: string
          detail?: Json | null
          event_type?: string
          id?: string
          placement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlink_monitoring_events_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "published_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          client_id: string | null
          created_at: string
          deadline: string | null
          id: string
          link_type: string | null
          max_price: number | null
          min_dr: number | null
          min_traffic: number | null
          name: string
          notes: string | null
          organization_id: string
          preferred_anchors: string[] | null
          target_keywords: string[] | null
          target_url: string | null
          total_budget: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          link_type?: string | null
          max_price?: number | null
          min_dr?: number | null
          min_traffic?: number | null
          name: string
          notes?: string | null
          organization_id: string
          preferred_anchors?: string[] | null
          target_keywords?: string[] | null
          target_url?: string | null
          total_budget?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          link_type?: string | null
          max_price?: number | null
          min_dr?: number | null
          min_traffic?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          preferred_anchors?: string[] | null
          target_keywords?: string[] | null
          target_url?: string | null
          total_budget?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          status: string
          website: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          status?: string
          website?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          status?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_submissions: {
        Row: {
          created_at: string
          file_path: string | null
          id: string
          notes: string | null
          order_id: string
          submitted_by: string
        }
        Insert: {
          created_at?: string
          file_path?: string | null
          id?: string
          notes?: string | null
          order_id: string
          submitted_by: string
        }
        Update: {
          created_at?: string
          file_path?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_submissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          id: string
          order_id: string
          raised_by: string
          reason: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          raised_by: string
          reason: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          raised_by?: string
          reason?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          order_id: string | null
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          order_id?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          order_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          anchor_text: string | null
          article_content: string | null
          article_title: string | null
          campaign_id: string | null
          created_at: string
          created_by: string
          customer_price: number
          id: string
          order_type: string
          organization_id: string
          status: string
          target_url: string
          updated_at: string
          website_id: string
        }
        Insert: {
          anchor_text?: string | null
          article_content?: string | null
          article_title?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by: string
          customer_price: number
          id?: string
          order_type: string
          organization_id: string
          status?: string
          target_url: string
          updated_at?: string
          website_id: string
        }
        Update: {
          anchor_text?: string | null
          article_content?: string | null
          article_title?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string
          customer_price?: number
          id?: string
          order_type?: string
          organization_id?: string
          status?: string
          target_url?: string
          updated_at?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "publisher_websites"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by: string
          organization_id: string
          role: string
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          kind: "team" | "personal"
          name: string
          owner_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: "team" | "personal"
          name: string
          owner_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          account_identifier: string
          enabled: boolean
          id: string
          instructions: string | null
          name: string
        }
        Insert: {
          account_identifier: string
          enabled?: boolean
          id?: string
          instructions?: string | null
          name: string
        }
        Update: {
          account_identifier?: string
          enabled?: boolean
          id?: string
          instructions?: string | null
          name?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          currency: string
          id: string
          method_id: string | null
          order_id: string
          proof_file_path: string | null
          rejection_reason: string | null
          status: string
          submitted_at: string
          transaction_reference: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          currency?: string
          id?: string
          method_id?: string | null
          order_id: string
          proof_file_path?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string
          transaction_reference?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          currency?: string
          id?: string
          method_id?: string | null
          order_id?: string
          proof_file_path?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string
          transaction_reference?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          platform_role: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          platform_role?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          platform_role?: string
        }
        Relationships: []
      }
      published_placements: {
        Row: {
          created_at: string
          health: string
          id: string
          order_id: string
          published_url: string
          submitted_by: string
        }
        Insert: {
          created_at?: string
          health?: string
          id?: string
          order_id: string
          published_url: string
          submitted_by: string
        }
        Update: {
          created_at?: string
          health?: string
          id?: string
          order_id?: string
          published_url?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "published_placements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_placements_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "publisher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_metrics: {
        Row: {
          da: number | null
          dr: number | null
          organic_traffic: number | null
          spam_score: number | null
          verified: boolean
          verified_at: string | null
          website_id: string
        }
        Insert: {
          da?: number | null
          dr?: number | null
          organic_traffic?: number | null
          spam_score?: number | null
          verified?: boolean
          verified_at?: string | null
          website_id: string
        }
        Update: {
          da?: number | null
          dr?: number | null
          organic_traffic?: number | null
          spam_score?: number | null
          verified?: boolean
          verified_at?: string | null
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publisher_metrics_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: true
            referencedRelation: "publisher_websites"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_payouts: {
        Row: {
          amount: number
          id: string
          method: string | null
          order_id: string | null
          processed_at: string | null
          publisher_id: string
          status: string
          transaction_reference: string | null
        }
        Insert: {
          amount: number
          id?: string
          method?: string | null
          order_id?: string | null
          processed_at?: string | null
          publisher_id: string
          status?: string
          transaction_reference?: string | null
        }
        Update: {
          amount?: number
          id?: string
          method?: string | null
          order_id?: string | null
          processed_at?: string | null
          publisher_id?: string
          status?: string
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publisher_payouts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publisher_payouts_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publisher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_profiles: {
        Row: {
          approved: boolean
          bio: string | null
          created_at: string
          display_name: string
          id: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publisher_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_supplier_info: {
        Row: {
          last_negotiated_price: number | null
          margin: number | null
          payment_method: string | null
          reliability_notes: string | null
          supplier_contact: string | null
          supplier_cost: number | null
          supplier_name: string | null
          updated_at: string
          website_id: string
        }
        Insert: {
          last_negotiated_price?: number | null
          margin?: number | null
          payment_method?: string | null
          reliability_notes?: string | null
          supplier_contact?: string | null
          supplier_cost?: number | null
          supplier_name?: string | null
          updated_at?: string
          website_id: string
        }
        Update: {
          last_negotiated_price?: number | null
          margin?: number | null
          payment_method?: string | null
          reliability_notes?: string | null
          supplier_contact?: string | null
          supplier_cost?: number | null
          supplier_name?: string | null
          updated_at?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publisher_supplier_info_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: true
            referencedRelation: "publisher_websites"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_websites: {
        Row: {
          article_requirements: string | null
          country: string | null
          created_at: string
          description: string | null
          domain: string
          id: string
          language: string | null
          last_verified_at: string | null
          link_type: string | null
          niche: string | null
          price_guest_post: number | null
          price_link_insertion: number | null
          publisher_id: string
          status: string
          turnaround_days_max: number | null
          turnaround_days_min: number | null
        }
        Insert: {
          article_requirements?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          language?: string | null
          last_verified_at?: string | null
          link_type?: string | null
          niche?: string | null
          price_guest_post?: number | null
          price_link_insertion?: number | null
          publisher_id: string
          status?: string
          turnaround_days_max?: number | null
          turnaround_days_min?: number | null
        }
        Update: {
          article_requirements?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          language?: string | null
          last_verified_at?: string | null
          link_type?: string | null
          niche?: string | null
          price_guest_post?: number | null
          price_link_insertion?: number | null
          publisher_id?: string
          status?: string
          turnaround_days_max?: number | null
          turnaround_days_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "publisher_websites_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publisher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_publishers: {
        Row: {
          created_at: string
          organization_id: string
          saved_by: string
          website_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          saved_by: string
          website_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          saved_by?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_publishers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_publishers_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_publishers_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "publisher_websites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      is_org_owner: { Args: { org_id: string }; Returns: boolean }
      is_publisher_owner: { Args: { p_publisher_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
