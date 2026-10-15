export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      answers: {
        Row: {
          created_at: string;
          id: string;
          question_id: string;
          questionnaire_response_id: string;
          value: Json | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          question_id: string;
          questionnaire_response_id: string;
          value?: Json | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          question_id?: string;
          questionnaire_response_id?: string;
          value?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "answers_questionnaire_response_id_fkey";
            columns: ["questionnaire_response_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_responses";
            referencedColumns: ["id"];
          },
        ];
      };
      application_resubmission_attempts: {
        Row: {
          application_id: string;
          attempted_at: string;
          id: string;
        };
        Insert: {
          application_id: string;
          attempted_at?: string;
          id?: string;
        };
        Update: {
          application_id?: string;
          attempted_at?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_resubmission_attempts_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      application_stage_entries: {
        Row: {
          application_id: string;
          first_entered_at: string;
          id: string;
          position_stage_id: string;
        };
        Insert: {
          application_id: string;
          first_entered_at?: string;
          id?: string;
          position_stage_id: string;
        };
        Update: {
          application_id?: string;
          first_entered_at?: string;
          id?: string;
          position_stage_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_stage_entries_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "application_stage_entries_position_stage_id_fkey";
            columns: ["position_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          application_form_answers: Json;
          applied_at: string;
          created_at: string;
          current_stage_id: string | null;
          id: string;
          person_id: string;
          position_id: string;
          seen: boolean;
          source: Database["public"]["Enums"]["application_source"];
          stage_entered_at: string;
          starred: boolean;
          status: Database["public"]["Enums"]["application_status"];
          updated_at: string;
        };
        Insert: {
          application_form_answers?: Json;
          applied_at?: string;
          created_at?: string;
          current_stage_id?: string | null;
          id?: string;
          person_id: string;
          position_id: string;
          seen?: boolean;
          source?: Database["public"]["Enums"]["application_source"];
          stage_entered_at?: string;
          starred?: boolean;
          status?: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
        };
        Update: {
          application_form_answers?: Json;
          applied_at?: string;
          created_at?: string;
          current_stage_id?: string | null;
          id?: string;
          person_id?: string;
          position_id?: string;
          seen?: boolean;
          source?: Database["public"]["Enums"]["application_source"];
          stage_entered_at?: string;
          starred?: boolean;
          status?: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "applications_current_stage_id_fkey";
            columns: ["current_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "positions";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_worker_config: {
        Row: {
          enabled: boolean;
          endpoint_url: string | null;
          id: boolean;
          orphan_cleanup_enabled: boolean;
          shared_secret: string | null;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean;
          endpoint_url?: string | null;
          id?: boolean;
          orphan_cleanup_enabled?: boolean;
          shared_secret?: string | null;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          endpoint_url?: string | null;
          id?: boolean;
          orphan_cleanup_enabled?: boolean;
          shared_secret?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      deleted_application_uploads: {
        Row: {
          bucket_id: string;
          deleted_at: string;
          file_name: string | null;
          file_type: string | null;
          id: number;
          position_id: string | null;
          reason: string;
          run_id: number | null;
          size_bytes: number | null;
          storage_path: string;
          uploaded_at: string | null;
        };
        Insert: {
          bucket_id: string;
          deleted_at?: string;
          file_name?: string | null;
          file_type?: string | null;
          id?: never;
          position_id?: string | null;
          reason?: string;
          run_id?: number | null;
          size_bytes?: number | null;
          storage_path: string;
          uploaded_at?: string | null;
        };
        Update: {
          bucket_id?: string;
          deleted_at?: string;
          file_name?: string | null;
          file_type?: string | null;
          id?: never;
          position_id?: string | null;
          reason?: string;
          run_id?: number | null;
          size_bytes?: number | null;
          storage_path?: string;
          uploaded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deleted_application_uploads_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "orphan_cleanup_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      departments: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      email_timing_settings: {
        Row: {
          automation_safety_delay_minutes: number;
          id: boolean;
          send_undo_minutes: number;
          updated_at: string;
        };
        Insert: {
          automation_safety_delay_minutes?: number;
          id?: boolean;
          send_undo_minutes?: number;
          updated_at?: string;
        };
        Update: {
          automation_safety_delay_minutes?: number;
          id?: boolean;
          send_undo_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          application_id: string | null;
          created_at: string;
          filename: string | null;
          id: string;
          kind: Database["public"]["Enums"]["document_kind"];
          mime_type: string | null;
          person_id: string;
          storage_path: string;
        };
        Insert: {
          application_id?: string | null;
          created_at?: string;
          filename?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["document_kind"];
          mime_type?: string | null;
          person_id: string;
          storage_path: string;
        };
        Update: {
          application_id?: string | null;
          created_at?: string;
          filename?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["document_kind"];
          mime_type?: string | null;
          person_id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      message_templates: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          name: string;
          subject: string | null;
          updated_at: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          subject?: string | null;
          updated_at?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          subject?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      message_threads: {
        Row: {
          application_id: string | null;
          created_at: string;
          id: string;
          last_inbound_at: string | null;
          last_message_at: string;
          normalized_subject: string;
          person_id: string;
          position_id: string | null;
          read_at: string | null;
          subject: string | null;
        };
        Insert: {
          application_id?: string | null;
          created_at?: string;
          id?: string;
          last_inbound_at?: string | null;
          last_message_at?: string;
          normalized_subject: string;
          person_id: string;
          position_id?: string | null;
          read_at?: string | null;
          subject?: string | null;
        };
        Update: {
          application_id?: string | null;
          created_at?: string;
          id?: string;
          last_inbound_at?: string | null;
          last_message_at?: string;
          normalized_subject?: string;
          person_id?: string;
          position_id?: string | null;
          read_at?: string | null;
          subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "message_threads_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_threads_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_threads_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "positions";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          application_id: string | null;
          attachments: Json;
          bcc: Json;
          body: string | null;
          cancelled_at: string | null;
          cc: Json;
          created_at: string;
          direction: Database["public"]["Enums"]["message_direction"];
          failure_reason: string | null;
          from_address: string | null;
          headers: Json;
          id: string;
          inbound_email_id: string | null;
          person_id: string;
          relay_message_id: string | null;
          rfc_message_id: string | null;
          scheduled_for: string | null;
          send_claimed_at: string | null;
          sender_user_id: string | null;
          sent_at: string | null;
          status: string | null;
          subject: string | null;
          thread_id: string | null;
          to_address: string | null;
        };
        Insert: {
          application_id?: string | null;
          attachments?: Json;
          bcc?: Json;
          body?: string | null;
          cancelled_at?: string | null;
          cc?: Json;
          created_at?: string;
          direction: Database["public"]["Enums"]["message_direction"];
          failure_reason?: string | null;
          from_address?: string | null;
          headers?: Json;
          id?: string;
          inbound_email_id?: string | null;
          person_id: string;
          relay_message_id?: string | null;
          rfc_message_id?: string | null;
          scheduled_for?: string | null;
          send_claimed_at?: string | null;
          sender_user_id?: string | null;
          sent_at?: string | null;
          status?: string | null;
          subject?: string | null;
          thread_id?: string | null;
          to_address?: string | null;
        };
        Update: {
          application_id?: string | null;
          attachments?: Json;
          bcc?: Json;
          body?: string | null;
          cancelled_at?: string | null;
          cc?: Json;
          created_at?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          failure_reason?: string | null;
          from_address?: string | null;
          headers?: Json;
          id?: string;
          inbound_email_id?: string | null;
          person_id?: string;
          relay_message_id?: string | null;
          rfc_message_id?: string | null;
          scheduled_for?: string | null;
          send_claimed_at?: string | null;
          sender_user_id?: string | null;
          sent_at?: string | null;
          status?: string | null;
          subject?: string | null;
          thread_id?: string | null;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_user_id_fkey";
            columns: ["sender_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "message_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          application_id: string;
          author_user_id: string | null;
          body: string;
          created_at: string;
          id: string;
        };
        Insert: {
          application_id: string;
          author_user_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
        };
        Update: {
          application_id?: string;
          author_user_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notes_author_user_id_fkey";
            columns: ["author_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      orphan_cleanup_runs: {
        Row: {
          bytes_freed: number;
          deferred: number;
          errors: string[];
          failed: number;
          finished_at: string | null;
          found: number;
          grace: string;
          id: number;
          removed: number;
          started_at: string;
        };
        Insert: {
          bytes_freed?: number;
          deferred?: number;
          errors?: string[];
          failed?: number;
          finished_at?: string | null;
          found?: number;
          grace: string;
          id?: never;
          removed?: number;
          started_at?: string;
        };
        Update: {
          bytes_freed?: number;
          deferred?: number;
          errors?: string[];
          failed?: number;
          finished_at?: string | null;
          found?: number;
          grace?: string;
          id?: never;
          removed?: number;
          started_at?: string;
        };
        Relationships: [];
      };
      people: {
        Row: {
          created_at: string;
          custom_attributes: Json;
          email: string;
          first_name: string;
          headline: string | null;
          id: string;
          last_name: string | null;
          links: Json;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          custom_attributes?: Json;
          email: string;
          first_name: string;
          headline?: string | null;
          id?: string;
          last_name?: string | null;
          links?: Json;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          custom_attributes?: Json;
          email?: string;
          first_name?: string;
          headline?: string | null;
          id?: string;
          last_name?: string | null;
          links?: Json;
          phone?: string | null;
        };
        Relationships: [];
      };
      pipeline_template_stages: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          pipeline_id: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          pipeline_id: string;
          sort_order: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          pipeline_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "pipeline_template_stages_pipeline_id_fkey";
            columns: ["pipeline_id"];
            isOneToOne: false;
            referencedRelation: "pipelines";
            referencedColumns: ["id"];
          },
        ];
      };
      pipelines: {
        Row: {
          created_at: string;
          id: string;
          is_template: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_template?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_template?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      position_stages: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          position_id: string;
          sort_order: number;
          source_template_stage_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          position_id: string;
          sort_order: number;
          source_template_stage_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          position_id?: string;
          sort_order?: number;
          source_template_stage_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "position_stages_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "positions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "position_stages_source_template_stage_id_fkey";
            columns: ["source_template_stage_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_template_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      positions: {
        Row: {
          application_form_config: Json;
          application_questionnaire_id: string | null;
          assigned_pipeline_id: string | null;
          created_at: string;
          department: string | null;
          description: string | null;
          education_level: string | null;
          education_level_required: boolean;
          email_sender_name: string | null;
          experience_level: string | null;
          hiring_team: Json;
          id: string;
          locations: Json;
          position_type: string | null;
          publish_mode: Database["public"]["Enums"]["publish_mode"];
          remote_flag: boolean;
          salary_currency: string | null;
          salary_from: number | null;
          salary_period: Database["public"]["Enums"]["salary_period"] | null;
          salary_to: number | null;
          slug: string;
          status: Database["public"]["Enums"]["position_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          application_form_config?: Json;
          application_questionnaire_id?: string | null;
          assigned_pipeline_id?: string | null;
          created_at?: string;
          department?: string | null;
          description?: string | null;
          education_level?: string | null;
          education_level_required?: boolean;
          email_sender_name?: string | null;
          experience_level?: string | null;
          hiring_team?: Json;
          id?: string;
          locations?: Json;
          position_type?: string | null;
          publish_mode?: Database["public"]["Enums"]["publish_mode"];
          remote_flag?: boolean;
          salary_currency?: string | null;
          salary_from?: number | null;
          salary_period?: Database["public"]["Enums"]["salary_period"] | null;
          salary_to?: number | null;
          slug: string;
          status?: Database["public"]["Enums"]["position_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          application_form_config?: Json;
          application_questionnaire_id?: string | null;
          assigned_pipeline_id?: string | null;
          created_at?: string;
          department?: string | null;
          description?: string | null;
          education_level?: string | null;
          education_level_required?: boolean;
          email_sender_name?: string | null;
          experience_level?: string | null;
          hiring_team?: Json;
          id?: string;
          locations?: Json;
          position_type?: string | null;
          publish_mode?: Database["public"]["Enums"]["publish_mode"];
          remote_flag?: boolean;
          salary_currency?: string | null;
          salary_from?: number | null;
          salary_period?: Database["public"]["Enums"]["salary_period"] | null;
          salary_to?: number | null;
          slug?: string;
          status?: Database["public"]["Enums"]["position_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "positions_application_questionnaire_id_fkey";
            columns: ["application_questionnaire_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positions_assigned_pipeline_id_fkey";
            columns: ["assigned_pipeline_id"];
            isOneToOne: false;
            referencedRelation: "pipelines";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      public_submission_attempts: {
        Row: {
          created_at: string;
          email: string | null;
          id: number;
          ip: string;
          kind: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          id?: never;
          ip: string;
          kind: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: never;
          ip?: string;
          kind?: string;
        };
        Relationships: [];
      };
      questionnaire_responses: {
        Row: {
          access_token_expires_at: string | null;
          access_token_hash: string | null;
          access_token_issued_at: string | null;
          application_id: string;
          completed_at: string | null;
          context: Database["public"]["Enums"]["questionnaire_context"];
          created_at: string;
          id: string;
          on_completion_move_to_stage_id: string | null;
          origin_stage_id: string | null;
          questionnaire_template_id: string;
          reminder_config: Json | null;
          reminders_stopped_at: string | null;
          sent_at: string | null;
          stage_action_id: string | null;
          status: Database["public"]["Enums"]["questionnaire_status"];
        };
        Insert: {
          access_token_expires_at?: string | null;
          access_token_hash?: string | null;
          access_token_issued_at?: string | null;
          application_id: string;
          completed_at?: string | null;
          context: Database["public"]["Enums"]["questionnaire_context"];
          created_at?: string;
          id?: string;
          on_completion_move_to_stage_id?: string | null;
          origin_stage_id?: string | null;
          questionnaire_template_id: string;
          reminder_config?: Json | null;
          reminders_stopped_at?: string | null;
          sent_at?: string | null;
          stage_action_id?: string | null;
          status?: Database["public"]["Enums"]["questionnaire_status"];
        };
        Update: {
          access_token_expires_at?: string | null;
          access_token_hash?: string | null;
          access_token_issued_at?: string | null;
          application_id?: string;
          completed_at?: string | null;
          context?: Database["public"]["Enums"]["questionnaire_context"];
          created_at?: string;
          id?: string;
          on_completion_move_to_stage_id?: string | null;
          origin_stage_id?: string | null;
          questionnaire_template_id?: string;
          reminder_config?: Json | null;
          reminders_stopped_at?: string | null;
          sent_at?: string | null;
          stage_action_id?: string | null;
          status?: Database["public"]["Enums"]["questionnaire_status"];
        };
        Relationships: [
          {
            foreignKeyName: "questionnaire_responses_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questionnaire_responses_on_completion_move_to_stage_id_fkey";
            columns: ["on_completion_move_to_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questionnaire_responses_origin_stage_id_fkey";
            columns: ["origin_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questionnaire_responses_questionnaire_template_id_fkey";
            columns: ["questionnaire_template_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questionnaire_responses_stage_action_id_fkey";
            columns: ["stage_action_id"];
            isOneToOne: false;
            referencedRelation: "stage_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      questionnaire_email_settings: {
        Row: {
          id: boolean;
          invite_body: string;
          invite_subject: string;
          reminder_body: string;
          reminder_subject: string;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          invite_body: string;
          invite_subject: string;
          reminder_body: string;
          reminder_subject: string;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          invite_body?: string;
          invite_subject?: string;
          reminder_body?: string;
          reminder_subject?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      questionnaire_templates: {
        Row: {
          created_at: string;
          id: string;
          invite_body: string | null;
          invite_email_mode: string;
          invite_subject: string | null;
          name: string;
          on_completion_template_stage_id: string | null;
          reminder_body: string | null;
          reminder_email_mode: string;
          reminder_subject: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invite_body?: string | null;
          invite_email_mode?: string;
          invite_subject?: string | null;
          name: string;
          on_completion_template_stage_id?: string | null;
          reminder_body?: string | null;
          reminder_email_mode?: string;
          reminder_subject?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invite_body?: string | null;
          invite_email_mode?: string;
          invite_subject?: string | null;
          name?: string;
          on_completion_template_stage_id?: string | null;
          reminder_body?: string | null;
          reminder_email_mode?: string;
          reminder_subject?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questionnaire_templates_on_completion_template_stage_id_fkey";
            columns: ["on_completion_template_stage_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_template_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          answer_routing: Json;
          created_at: string;
          help_text: string | null;
          id: string;
          numeric_max: number | null;
          numeric_min: number | null;
          options: Json;
          prompt: string;
          questionnaire_template_id: string;
          required: boolean;
          sort_order: number;
          type: Database["public"]["Enums"]["question_type"];
          video_allow_retakes: boolean | null;
          video_max_duration: number | null;
        };
        Insert: {
          answer_routing?: Json;
          created_at?: string;
          help_text?: string | null;
          id?: string;
          numeric_max?: number | null;
          numeric_min?: number | null;
          options?: Json;
          prompt: string;
          questionnaire_template_id: string;
          required?: boolean;
          sort_order: number;
          type: Database["public"]["Enums"]["question_type"];
          video_allow_retakes?: boolean | null;
          video_max_duration?: number | null;
        };
        Update: {
          answer_routing?: Json;
          created_at?: string;
          help_text?: string | null;
          id?: string;
          numeric_max?: number | null;
          numeric_min?: number | null;
          options?: Json;
          prompt?: string;
          questionnaire_template_id?: string;
          required?: boolean;
          sort_order?: number;
          type?: Database["public"]["Enums"]["question_type"];
          video_allow_retakes?: boolean | null;
          video_max_duration?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "questions_questionnaire_template_id_fkey";
            columns: ["questionnaire_template_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_actions: {
        Row: {
          application_id: string;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          failure_reason: string | null;
          id: string;
          kind: Database["public"]["Enums"]["scheduled_action_kind"];
          message_id: string | null;
          origin_stage_id: string | null;
          questionnaire_response_id: string | null;
          reminder_number: number | null;
          scheduled_for: string;
          stage_action_id: string | null;
          status: Database["public"]["Enums"]["scheduled_action_status"];
        };
        Insert: {
          application_id: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["scheduled_action_kind"];
          message_id?: string | null;
          origin_stage_id?: string | null;
          questionnaire_response_id?: string | null;
          reminder_number?: number | null;
          scheduled_for: string;
          stage_action_id?: string | null;
          status?: Database["public"]["Enums"]["scheduled_action_status"];
        };
        Update: {
          application_id?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["scheduled_action_kind"];
          message_id?: string | null;
          origin_stage_id?: string | null;
          questionnaire_response_id?: string | null;
          reminder_number?: number | null;
          scheduled_for?: string;
          stage_action_id?: string | null;
          status?: Database["public"]["Enums"]["scheduled_action_status"];
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_actions_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "stalled_scheduled_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_origin_stage_id_fkey";
            columns: ["origin_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_questionnaire_response_id_fkey";
            columns: ["questionnaire_response_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_responses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_stage_action_id_fkey";
            columns: ["stage_action_id"];
            isOneToOne: false;
            referencedRelation: "stage_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      slack_config: {
        Row: {
          channel_id: string | null;
          channel_name: string | null;
          created_at: string;
          enabled: boolean;
          id: boolean;
          updated_at: string;
        };
        Insert: {
          channel_id?: string | null;
          channel_name?: string | null;
          created_at?: string;
          enabled?: boolean;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          channel_id?: string | null;
          channel_name?: string | null;
          created_at?: string;
          enabled?: boolean;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      slack_credentials: {
        Row: {
          bot_token: string | null;
          bot_token_set_at: string | null;
          id: boolean;
          updated_at: string;
        };
        Insert: {
          bot_token?: string | null;
          bot_token_set_at?: string | null;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          bot_token?: string | null;
          bot_token_set_at?: string | null;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      slack_notifications: {
        Row: {
          channel_id: string | null;
          created_at: string;
          detail: string | null;
          id: string;
          message_id: string;
          slack_message_ts: string | null;
          status: Database["public"]["Enums"]["slack_notification_status"];
        };
        Insert: {
          channel_id?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          message_id: string;
          slack_message_ts?: string | null;
          status: Database["public"]["Enums"]["slack_notification_status"];
        };
        Update: {
          channel_id?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          message_id?: string;
          slack_message_ts?: string | null;
          status?: Database["public"]["Enums"]["slack_notification_status"];
        };
        Relationships: [
          {
            foreignKeyName: "slack_notifications_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "slack_notifications_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "stalled_scheduled_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      stage_actions: {
        Row: {
          created_at: string;
          delay_minutes: number;
          enabled: boolean;
          id: string;
          message_template_id: string | null;
          position_stage_id: string;
          questionnaire_template_id: string | null;
          reminder_config: Json | null;
          sort_order: number;
          target_position_stage_id: string | null;
          type: Database["public"]["Enums"]["stage_action_type"];
        };
        Insert: {
          created_at?: string;
          delay_minutes?: number;
          enabled?: boolean;
          id?: string;
          message_template_id?: string | null;
          position_stage_id: string;
          questionnaire_template_id?: string | null;
          reminder_config?: Json | null;
          sort_order?: number;
          target_position_stage_id?: string | null;
          type: Database["public"]["Enums"]["stage_action_type"];
        };
        Update: {
          created_at?: string;
          delay_minutes?: number;
          enabled?: boolean;
          id?: string;
          message_template_id?: string | null;
          position_stage_id?: string;
          questionnaire_template_id?: string | null;
          reminder_config?: Json | null;
          sort_order?: number;
          target_position_stage_id?: string | null;
          type?: Database["public"]["Enums"]["stage_action_type"];
        };
        Relationships: [
          {
            foreignKeyName: "stage_actions_message_template_fk";
            columns: ["message_template_id"];
            isOneToOne: false;
            referencedRelation: "message_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_actions_position_stage_id_fkey";
            columns: ["position_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_actions_questionnaire_template_id_fkey";
            columns: ["questionnaire_template_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_actions_target_position_stage_id_fkey";
            columns: ["target_position_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      unmatched_inbound_emails: {
        Row: {
          attachments: Json;
          body_html: string | null;
          body_text: string | null;
          created_at: string;
          from_address: string;
          headers: Json;
          id: string;
          reason: string;
          received_at: string;
          relay_email_id: string;
          rfc_message_id: string | null;
          subject: string | null;
          to_addresses: Json;
        };
        Insert: {
          attachments?: Json;
          body_html?: string | null;
          body_text?: string | null;
          created_at?: string;
          from_address: string;
          headers?: Json;
          id?: string;
          reason: string;
          received_at?: string;
          relay_email_id: string;
          rfc_message_id?: string | null;
          subject?: string | null;
          to_addresses?: Json;
        };
        Update: {
          attachments?: Json;
          body_html?: string | null;
          body_text?: string | null;
          created_at?: string;
          from_address?: string;
          headers?: Json;
          id?: string;
          reason?: string;
          received_at?: string;
          relay_email_id?: string;
          rfc_message_id?: string | null;
          subject?: string | null;
          to_addresses?: Json;
        };
        Relationships: [];
      };
    };
    Views: {
      stalled_scheduled_actions: {
        Row: {
          application_id: string | null;
          claimed_at: string | null;
          claimed_for: string | null;
          id: string | null;
          origin_stage_id: string | null;
          scheduled_for: string | null;
          stage_action_id: string | null;
        };
        Insert: {
          application_id?: string | null;
          claimed_at?: string | null;
          claimed_for?: never;
          id?: string | null;
          origin_stage_id?: string | null;
          scheduled_for?: string | null;
          stage_action_id?: string | null;
        };
        Update: {
          application_id?: string | null;
          claimed_at?: string | null;
          claimed_for?: never;
          id?: string | null;
          origin_stage_id?: string | null;
          scheduled_for?: string | null;
          stage_action_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_actions_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_origin_stage_id_fkey";
            columns: ["origin_stage_id"];
            isOneToOne: false;
            referencedRelation: "position_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_stage_action_id_fkey";
            columns: ["stage_action_id"];
            isOneToOne: false;
            referencedRelation: "stage_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      stalled_scheduled_messages: {
        Row: {
          application_id: string | null;
          claimed_for: string | null;
          id: string | null;
          person_id: string | null;
          scheduled_for: string | null;
          send_claimed_at: string | null;
          subject: string | null;
          thread_id: string | null;
          to_address: string | null;
        };
        Insert: {
          application_id?: string | null;
          claimed_for?: never;
          id?: string | null;
          person_id?: string | null;
          scheduled_for?: string | null;
          send_claimed_at?: string | null;
          subject?: string | null;
          thread_id?: string | null;
          to_address?: string | null;
        };
        Update: {
          application_id?: string | null;
          claimed_for?: never;
          id?: string | null;
          person_id?: string | null;
          scheduled_for?: string | null;
          send_claimed_at?: string | null;
          subject?: string | null;
          thread_id?: string | null;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "message_threads";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      anon_may_upload_application_object: {
        Args: { p_name: string };
        Returns: boolean;
      };
      cancel_pending_questionnaire_reminders: {
        Args: { p_now: string; p_questionnaire_response_id: string };
        Returns: number;
      };
      cancel_pending_stage_actions: {
        Args: {
          p_application_id: string;
          p_now: string;
          p_origin_stage_id: string;
        };
        Returns: number;
      };
      cancel_scheduled_message: {
        Args: { p_id: string; p_now: string };
        Returns: boolean;
      };
      claim_due_messages: {
        Args: { p_limit: number; p_now: string };
        Returns: string[];
      };
      claim_due_scheduled_actions: {
        Args: { p_limit: number; p_now: string };
        Returns: string[];
      };
      complete_scheduled_action: {
        Args: {
          p_failure_reason?: string;
          p_id: string;
          p_message_id?: string;
          p_now: string;
          p_status: Database["public"]["Enums"]["scheduled_action_status"];
        };
        Returns: boolean;
      };
      complete_scheduled_message: {
        Args: {
          p_failure_reason?: string;
          p_from_address?: string;
          p_id: string;
          p_now: string;
          p_relay_message_id?: string;
          p_rfc_message_id?: string;
          p_status: string;
        };
        Returns: boolean;
      };
      dispatch_due_scheduled_actions: {
        Args: { p_now?: string };
        Returns: number;
      };
      dispatch_orphan_cleanup: { Args: never; Returns: number };
      enqueue_answer_routing: {
        Args: { p_now: string; p_questionnaire_response_id: string };
        Returns: string;
      };
      first_stage_for_position: {
        Args: { p_position_id: string };
        Returns: string;
      };
      is_valid_reminder_config: { Args: { p_config: Json }; Returns: boolean };
      issue_questionnaire_access_token: {
        Args: {
          p_expires_at: string;
          p_now: string;
          p_questionnaire_response_id: string;
          p_token: string;
        };
        Returns: boolean;
      };
      orphaned_application_uploads: {
        Args: { p_grace?: string };
        Returns: {
          bucket_id: string;
          created_at: string;
          mime_type: string;
          name: string;
          size_bytes: number;
        }[];
      };
      position_stage_for_template_stage: {
        Args: { p_position_id: string; p_template_stage_id: string };
        Returns: string;
      };
      public_position_by_slug: {
        Args: { p_slug: string };
        Returns: {
          application_form_config: Json;
          application_questionnaire_id: string;
          assigned_pipeline_id: string;
          created_at: string;
          department: string;
          description: string;
          education_level: string;
          education_level_required: boolean;
          email_sender_name: string;
          experience_level: string;
          hiring_team: Json;
          id: string;
          locations: Json;
          position_type: string;
          publish_mode: Database["public"]["Enums"]["publish_mode"];
          remote_flag: boolean;
          salary_currency: string;
          salary_from: number;
          salary_period: Database["public"]["Enums"]["salary_period"];
          salary_to: number;
          slug: string;
          status: Database["public"]["Enums"]["position_status"];
          title: string;
        }[];
      };
      public_position_is_open: {
        Args: { p_position_id: string };
        Returns: boolean;
      };
      public_position_questions: {
        Args: { p_position_id: string };
        Returns: {
          help_text: string;
          id: string;
          numeric_max: number;
          numeric_min: number;
          options: Json;
          prompt: string;
          required: boolean;
          sort_order: number;
          type: Database["public"]["Enums"]["question_type"];
          video_allow_retakes: boolean;
          video_max_duration: number;
        }[];
      };
      public_questionnaire_by_token: {
        Args: { p_token: string };
        Returns: {
          expires_at: string;
          position_id: string;
          position_title: string;
          questionnaire_name: string;
        }[];
      };
      public_questionnaire_questions_by_token: {
        Args: { p_token: string };
        Returns: {
          help_text: string;
          id: string;
          numeric_max: number;
          numeric_min: number;
          options: Json;
          prompt: string;
          required: boolean;
          sort_order: number;
          type: Database["public"]["Enums"]["question_type"];
          video_allow_retakes: boolean;
          video_max_duration: number;
        }[];
      };
      public_questionnaire_token_state: {
        Args: { p_token: string };
        Returns: string;
      };
      questionnaire_token_hash: { Args: { p_token: string }; Returns: string };
      record_first_stage_entry: {
        Args: {
          p_application_id: string;
          p_at: string;
          p_position_stage_id: string;
        };
        Returns: boolean;
      };
      register_public_submission: {
        Args: { p_email: string; p_ip: string; p_kind: string; p_now: string };
        Returns: string;
      };
      report_available_months: {
        Args: { p_now: string };
        Returns: {
          month: string;
        }[];
      };
      report_month_applications: {
        Args: { p_month: string };
        Returns: {
          application_id: string;
          applied_at: string;
          day_of_month: number;
          is_archived: boolean;
          position_id: string;
          position_title: string;
          stage_id: string;
          stage_name: string;
          stage_sort_order: number;
        }[];
      };
      report_month_end: { Args: { p_month: string }; Returns: string };
      report_month_start: { Args: { p_month: string }; Returns: string };
      report_monthly_position_stages: {
        Args: { p_month: string };
        Returns: {
          applications: number;
          position_id: string;
          position_title: string;
          stage_id: string;
          stage_name: string;
        }[];
      };
      report_monthly_positions: {
        Args: { p_month: string };
        Returns: {
          applications_received: number;
          position_id: string;
          position_title: string;
        }[];
      };
      report_monthly_totals: {
        Args: { p_month: string };
        Returns: {
          applications_received: number;
          archived: number;
        }[];
      };
      report_monthly_weeks: {
        Args: { p_month: string };
        Returns: {
          applications_received: number;
          week_number: number;
        }[];
      };
      schedule_questionnaire_reminders: {
        Args: {
          p_now: string;
          p_questionnaire_response_id: string;
          p_schedule: Json;
        };
        Returns: number;
      };
      schedule_stage_actions: {
        Args: {
          p_application_id: string;
          p_now: string;
          p_position_stage_id: string;
        };
        Returns: number;
      };
      set_slack_bot_token: { Args: { p_token: string }; Returns: boolean };
      slack_bot_token_state: {
        Args: never;
        Returns: {
          configured: boolean;
          token_set_at: string;
        }[];
      };
      slack_delivery_config: {
        Args: never;
        Returns: {
          bot_token: string;
          channel_id: string;
          enabled: boolean;
        }[];
      };
      snapshot_pipeline_to_position: {
        Args: { p_pipeline_id: string; p_position_id: string };
        Returns: undefined;
      };
      submit_application: { Args: { payload: Json }; Returns: Json };
      submit_questionnaire_response: {
        Args: { p_answers: Json; p_token: string };
        Returns: Json;
      };
      defer_scheduled_action: {
        Args: { p_id: string; p_now: string; p_until: string };
        Returns: boolean;
      };
      defer_scheduled_message: {
        Args: { p_id: string; p_now: string; p_until: string };
        Returns: boolean;
      };
      unreferenced_upload_paths: { Args: { p_paths: string[] }; Returns: string[] };
    };
    Enums: {
      application_source: "public_apply";
      application_status: "active" | "archived";
      document_kind: "resume" | "video" | "other";
      message_direction: "inbound" | "outbound";
      position_status: "draft" | "open" | "closed" | "archived";
      publish_mode: "listed" | "unlisted" | "disabled";
      question_type:
        | "short_text"
        | "long_text"
        | "single_choice"
        | "multi_choice"
        | "dropdown"
        | "numeric"
        | "video"
        | "file"
        | "date"
        | "yes_no";
      questionnaire_context: "application_embedded" | "stage_sent" | "manual_sent";
      questionnaire_status: "pending" | "completed";
      salary_period: "year" | "month";
      scheduled_action_kind: "stage_action" | "reminder" | "answer_routing";
      scheduled_action_status: "pending" | "claimed" | "sent" | "failed" | "skipped" | "cancelled";
      slack_notification_status: "delivered" | "failed" | "skipped";
      stage_action_type: "send_email" | "send_questionnaire" | "move_to_stage";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      application_source: ["public_apply"],
      application_status: ["active", "archived"],
      document_kind: ["resume", "video", "other"],
      message_direction: ["inbound", "outbound"],
      position_status: ["draft", "open", "closed", "archived"],
      publish_mode: ["listed", "unlisted", "disabled"],
      question_type: [
        "short_text",
        "long_text",
        "single_choice",
        "multi_choice",
        "dropdown",
        "numeric",
        "video",
        "file",
        "date",
        "yes_no",
      ],
      questionnaire_context: ["application_embedded", "stage_sent", "manual_sent"],
      questionnaire_status: ["pending", "completed"],
      salary_period: ["year", "month"],
      scheduled_action_kind: ["stage_action", "reminder", "answer_routing"],
      scheduled_action_status: ["pending", "claimed", "sent", "failed", "skipped", "cancelled"],
      slack_notification_status: ["delivered", "failed", "skipped"],
      stage_action_type: ["send_email", "send_questionnaire", "move_to_stage"],
    },
  },
} as const;
