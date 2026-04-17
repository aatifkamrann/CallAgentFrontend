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
      call_conversations: {
        Row: {
          agent_type: string
          balance: number
          call_sid: string
          caller_name: string
          created_at: string
          customer_id: string
          customer_name: string
          dpd: number
          final_response: string | null
          follow_up_count: number
          id: string
          language: string
          messages: Json
          notes: string | null
          ptp_date: string | null
          ptp_status: string | null
          schedule_retry_hours: number | null
          status: string
          tone: string
          updated_at: string
          voice: string
        }
        Insert: {
          agent_type?: string
          balance?: number
          call_sid: string
          caller_name?: string
          created_at?: string
          customer_id: string
          customer_name: string
          dpd?: number
          final_response?: string | null
          follow_up_count?: number
          id?: string
          language?: string
          messages?: Json
          notes?: string | null
          ptp_date?: string | null
          ptp_status?: string | null
          schedule_retry_hours?: number | null
          status?: string
          tone?: string
          updated_at?: string
          voice?: string
        }
        Update: {
          agent_type?: string
          balance?: number
          call_sid?: string
          caller_name?: string
          created_at?: string
          customer_id?: string
          customer_name?: string
          dpd?: number
          final_response?: string | null
          follow_up_count?: number
          id?: string
          language?: string
          messages?: Json
          notes?: string | null
          ptp_date?: string | null
          ptp_status?: string | null
          schedule_retry_hours?: number | null
          status?: string
          tone?: string
          updated_at?: string
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          agent_type: string
          call_date_time: string
          created_at: string
          customer_id: string
          customer_name: string
          duration: number
          id: string
          notes: string | null
          outcome: string | null
          ptp_date: string | null
          recording_url: string | null
          status: string
          tone: string
          transcript: string | null
        }
        Insert: {
          agent_type?: string
          call_date_time?: string
          created_at?: string
          customer_id: string
          customer_name: string
          duration?: number
          id?: string
          notes?: string | null
          outcome?: string | null
          ptp_date?: string | null
          recording_url?: string | null
          status?: string
          tone?: string
          transcript?: string | null
        }
        Update: {
          agent_type?: string
          call_date_time?: string
          created_at?: string
          customer_id?: string
          customer_name?: string
          duration?: number
          id?: string
          notes?: string | null
          outcome?: string | null
          ptp_date?: string | null
          recording_url?: string | null
          status?: string
          tone?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          assigned_agent: string
          assigned_tone: string
          balance: number
          created_at: string
          dpd: number
          final_response: string | null
          follow_up_count: number
          gender: string
          id: string
          last_call_date: string | null
          name: string
          phone: string
          priority_score: number
          ptp_date: string | null
          ptp_status: string | null
          retry_reason: string | null
          scheduled_retry_at: string | null
          updated_at: string
        }
        Insert: {
          assigned_agent?: string
          assigned_tone?: string
          balance?: number
          created_at?: string
          dpd?: number
          final_response?: string | null
          follow_up_count?: number
          gender?: string
          id?: string
          last_call_date?: string | null
          name: string
          phone: string
          priority_score?: number
          ptp_date?: string | null
          ptp_status?: string | null
          retry_reason?: string | null
          scheduled_retry_at?: string | null
          updated_at?: string
        }
        Update: {
          assigned_agent?: string
          assigned_tone?: string
          balance?: number
          created_at?: string
          dpd?: number
          final_response?: string | null
          follow_up_count?: number
          gender?: string
          id?: string
          last_call_date?: string | null
          name?: string
          phone?: string
          priority_score?: number
          ptp_date?: string | null
          ptp_status?: string | null
          retry_reason?: string | null
          scheduled_retry_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
