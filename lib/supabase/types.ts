export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type WorkspaceRole = "owner" | "admin" | "manager" | "staff" | "viewer";

export type Database = {
  public: {
    Functions: {
      accept_workspace_invites_for_current_user: {
        Args: Record<string, never>;
        Returns: void;
      };
    };
    Views: Record<string, never>;
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          industry: string | null;
          size: string | null;
          logo_url: string | null;
          primary_contact_name: string | null;
          primary_contact_email: string | null;
          created_by: string | null;
          subscription_status: string;
          plan_slug: string | null;
          subscription_required: boolean;
          trial_ends_at: string | null;
          manually_unlocked: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          industry?: string | null;
          size?: string | null;
          logo_url?: string | null;
          primary_contact_name?: string | null;
          primary_contact_email?: string | null;
          created_by?: string | null;
          subscription_status?: string;
          plan_slug?: string | null;
          subscription_required?: boolean;
          trial_ends_at?: string | null;
          manually_unlocked?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["workspaces"]["Insert"]>;
        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string | null;
          role: WorkspaceRole;
          status: string;
          invited_email: string | null;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id?: string | null;
          role: WorkspaceRole;
          status?: string;
          invited_email?: string | null;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["workspace_members"]["Insert"]>;
        Relationships: [];
      };
      business_intakes: {
        Row: {
          id: string;
          workspace_id: string;
          company_name: string | null;
          industry: string | null;
          team_size: string | null;
          locations: string | null;
          current_tools: string | null;
          biggest_operational_problems: string | null;
          repeated_missed_tasks: string | null;
          customer_followup_process: string | null;
          employee_accountability_process: string | null;
          reporting_process: string | null;
          equipment_or_asset_process: string | null;
          onboarding_process: string | null;
          ideal_outcome: string | null;
          monthly_budget_range: string | null;
          urgency_level: string | null;
          raw_answers_json: Json;
          ai_summary: string | null;
          ai_recommendations: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          company_name?: string | null;
          industry?: string | null;
          team_size?: string | null;
          locations?: string | null;
          current_tools?: string | null;
          biggest_operational_problems?: string | null;
          repeated_missed_tasks?: string | null;
          customer_followup_process?: string | null;
          employee_accountability_process?: string | null;
          reporting_process?: string | null;
          equipment_or_asset_process?: string | null;
          onboarding_process?: string | null;
          ideal_outcome?: string | null;
          monthly_budget_range?: string | null;
          urgency_level?: string | null;
          raw_answers_json?: Json;
          ai_summary?: string | null;
          ai_recommendations?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_intakes"]["Insert"]>;
        Relationships: [];
      };
      workflow_maps: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          department: string | null;
          trigger_event: string | null;
          steps_json: Json;
          owner_role: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          department?: string | null;
          trigger_event?: string | null;
          steps_json?: Json;
          owner_role?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["workflow_maps"]["Insert"]>;
        Relationships: [];
      };
      forms: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          form_type: string | null;
          schema_json: Json;
          is_public: boolean;
          public_slug: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          form_type?: string | null;
          schema_json?: Json;
          is_public?: boolean;
          public_slug?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["forms"]["Insert"]>;
        Relationships: [];
      };
      form_submissions: {
        Row: {
          id: string;
          workspace_id: string;
          form_id: string;
          submitted_by: string | null;
          submitter_name: string | null;
          submitter_email: string | null;
          data_json: Json;
          ai_summary: string | null;
          ai_detected_priority: string | null;
          ai_detected_followups_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          form_id: string;
          submitted_by?: string | null;
          submitter_name?: string | null;
          submitter_email?: string | null;
          data_json?: Json;
          ai_summary?: string | null;
          ai_detected_priority?: string | null;
          ai_detected_followups_json?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["form_submissions"]["Insert"]>;
        Relationships: [];
      };
      checklists: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          category: string | null;
          frequency: string | null;
          items_json: Json;
          assigned_role: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          category?: string | null;
          frequency?: string | null;
          items_json?: Json;
          assigned_role?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checklists"]["Insert"]>;
        Relationships: [];
      };
      checklist_runs: {
        Row: {
          id: string;
          workspace_id: string;
          checklist_id: string;
          assigned_to: string | null;
          status: string;
          responses_json: Json;
          notes: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          checklist_id: string;
          assigned_to?: string | null;
          status?: string;
          responses_json?: Json;
          notes?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checklist_runs"]["Insert"]>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          title: string;
          description: string | null;
          status: string;
          priority: string;
          category: string | null;
          assigned_to: string | null;
          due_date: string | null;
          related_type: string | null;
          related_id: string | null;
          ai_generated: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          title: string;
          description?: string | null;
          status?: string;
          priority?: string;
          category?: string | null;
          assigned_to?: string | null;
          due_date?: string | null;
          related_type?: string | null;
          related_id?: string | null;
          ai_generated?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
        Relationships: [];
      };
      kpis: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          category: string | null;
          target: number | null;
          actual_value: number | null;
          metric_date: string;
          owner: string | null;
          notes: string | null;
          source: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          category?: string | null;
          target?: number | null;
          actual_value?: number | null;
          metric_date?: string;
          owner?: string | null;
          notes?: string | null;
          source?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["kpis"]["Insert"]>;
        Relationships: [];
      };
      issues: {
        Row: {
          id: string;
          workspace_id: string;
          title: string;
          description: string | null;
          issue_type: string | null;
          severity: string;
          status: string;
          root_cause: string | null;
          recommended_fix: string | null;
          assigned_to: string | null;
          due_date: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          title: string;
          description?: string | null;
          issue_type?: string | null;
          severity?: string;
          status?: string;
          root_cause?: string | null;
          recommended_fix?: string | null;
          assigned_to?: string | null;
          due_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["issues"]["Insert"]>;
        Relationships: [];
      };
      assets: {
        Row: {
          id: string;
          workspace_id: string;
          asset_name: string;
          asset_type: string | null;
          identifier: string | null;
          location: string | null;
          status: string;
          assigned_to: string | null;
          last_checked_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          asset_name: string;
          asset_type?: string | null;
          identifier?: string | null;
          location?: string | null;
          status?: string;
          assigned_to?: string | null;
          last_checked_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["assets"]["Insert"]>;
        Relationships: [];
      };
      asset_checks: {
        Row: {
          id: string;
          workspace_id: string;
          asset_id: string;
          checked_by: string | null;
          status: string;
          notes: string | null;
          photos_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          asset_id: string;
          checked_by?: string | null;
          status: string;
          notes?: string | null;
          photos_json?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["asset_checks"]["Insert"]>;
        Relationships: [];
      };
      people: {
        Row: {
          id: string;
          workspace_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          role_title: string | null;
          department: string | null;
          status: string;
          start_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          role_title?: string | null;
          department?: string | null;
          status?: string;
          start_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["people"]["Insert"]>;
        Relationships: [];
      };
      sops: {
        Row: {
          id: string;
          workspace_id: string;
          title: string;
          department: string | null;
          category: string | null;
          body_markdown: string | null;
          status: string;
          version: number;
          created_by: string | null;
          ai_generated: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          title: string;
          department?: string | null;
          category?: string | null;
          body_markdown?: string | null;
          status?: string;
          version?: number;
          created_by?: string | null;
          ai_generated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sops"]["Insert"]>;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          workspace_id: string;
          report_type: string;
          title: string;
          date_range_start: string | null;
          date_range_end: string | null;
          body_markdown: string | null;
          source_data_json: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          report_type: string;
          title: string;
          date_range_start?: string | null;
          date_range_end?: string | null;
          body_markdown?: string | null;
          source_data_json?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Insert"]>;
        Relationships: [];
      };
      ai_agent_runs: {
        Row: {
          id: string;
          workspace_id: string;
          agent_type: string;
          input_json: Json;
          output_json: Json;
          status: string;
          error_message: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          agent_type: string;
          input_json?: Json;
          output_json?: Json;
          status?: string;
          error_message?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_agent_runs"]["Insert"]>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          workspace_id: string;
          actor_user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          actor_user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata_json?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Insert"]>;
        Relationships: [];
      };
      subscription_plans: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          monthly_price_cents: number | null;
          annual_price_cents: number | null;
          max_workspaces: number | null;
          max_users: number | null;
          max_forms: number | null;
          max_checklists: number | null;
          max_ai_runs_per_month: number | null;
          features_json: Json;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          monthly_price_cents?: number | null;
          annual_price_cents?: number | null;
          max_workspaces?: number | null;
          max_users?: number | null;
          max_forms?: number | null;
          max_checklists?: number | null;
          max_ai_runs_per_month?: number | null;
          features_json?: Json;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscription_plans"]["Insert"]>;
        Relationships: [];
      };
      customer_subscriptions: {
        Row: {
          id: string;
          user_id: string | null;
          workspace_id: string | null;
          customer_email: string;
          customer_name: string | null;
          source: string;
          plan_slug: string | null;
          status: string;
          squarespace_order_id: string | null;
          squarespace_customer_id: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          canceled_at: string | null;
          last_payment_at: string | null;
          raw_payload_json: Json;
          manually_activated: boolean;
          manually_activated_by: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          workspace_id?: string | null;
          customer_email: string;
          customer_name?: string | null;
          source?: string;
          plan_slug?: string | null;
          status?: string;
          squarespace_order_id?: string | null;
          squarespace_customer_id?: string | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
          canceled_at?: string | null;
          last_payment_at?: string | null;
          raw_payload_json?: Json;
          manually_activated?: boolean;
          manually_activated_by?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["customer_subscriptions"]["Insert"]>;
        Relationships: [];
      };
      subscription_events: {
        Row: {
          id: string;
          source: string;
          event_type: string | null;
          customer_email: string | null;
          squarespace_order_id: string | null;
          payload_json: Json;
          processed: boolean;
          processing_error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source?: string;
          event_type?: string | null;
          customer_email?: string | null;
          squarespace_order_id?: string | null;
          payload_json?: Json;
          processed?: boolean;
          processing_error?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscription_events"]["Insert"]>;
        Relationships: [];
      };
      ai_usage: {
        Row: {
          id: string;
          workspace_id: string | null;
          user_id: string | null;
          agent_type: string | null;
          tokens_used: number;
          estimated_cost_cents: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id?: string | null;
          user_id?: string | null;
          agent_type?: string | null;
          tokens_used?: number;
          estimated_cost_cents?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_usage"]["Insert"]>;
        Relationships: [];
      };
      manual_activation_requests: {
        Row: {
          id: string;
          name: string;
          email: string;
          company: string | null;
          plan_purchased: string | null;
          order_number: string | null;
          message: string | null;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          company?: string | null;
          plan_purchased?: string | null;
          order_number?: string | null;
          message?: string | null;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["manual_activation_requests"]["Insert"]>;
        Relationships: [];
      };
      support_requests: {
        Row: {
          id: string;
          workspace_id: string | null;
          user_id: string | null;
          name: string;
          email: string;
          issue_type: string;
          message: string;
          priority: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id?: string | null;
          user_id?: string | null;
          name: string;
          email: string;
          issue_type: string;
          message: string;
          priority?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_requests"]["Insert"]>;
        Relationships: [];
      };
    };
  };
};

export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
export type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
