export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      alerts: {
        Row: {
          activation_version: number
          created_at: string
          direction: Database["public"]["Enums"]["alert_direction"]
          id: string
          is_active: boolean
          threshold_usd: number
          updated_at: string
          user_id: string
          watchlist_id: string
        }
        Insert: {
          activation_version?: number
          created_at?: string
          direction: Database["public"]["Enums"]["alert_direction"]
          id?: string
          is_active?: boolean
          threshold_usd: number
          updated_at?: string
          user_id: string
          watchlist_id: string
        }
        Update: {
          activation_version?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["alert_direction"]
          id?: string
          is_active?: boolean
          threshold_usd?: number
          updated_at?: string
          user_id?: string
          watchlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_watchlist_owner_fkey"
            columns: ["watchlist_id", "user_id"]
            isOneToOne: false
            referencedRelation: "watchlist"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      coins: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_seen_sync_id: string | null
          name: string
          symbol: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          last_seen_sync_id?: string | null
          name: string
          symbol: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_sync_id?: string | null
          name?: string
          symbol?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          activation_version: number
          alert_id: string | null
          coin_id: string
          coin_name: string
          coin_symbol: string
          created_at: string
          delivery_attempts: number
          direction: Database["public"]["Enums"]["alert_direction"]
          first_attempt_at: string | null
          id: string
          last_error: string | null
          recipient_email: string
          resend_email_id: string | null
          sent_at: string | null
          source_alert_id: string
          status: Database["public"]["Enums"]["notification_status"]
          threshold_usd: number
          trigger_price_usd: number
          user_id: string
        }
        Insert: {
          activation_version: number
          alert_id?: string | null
          coin_id: string
          coin_name: string
          coin_symbol: string
          created_at?: string
          delivery_attempts?: number
          direction: Database["public"]["Enums"]["alert_direction"]
          first_attempt_at?: string | null
          id?: string
          last_error?: string | null
          recipient_email: string
          resend_email_id?: string | null
          sent_at?: string | null
          source_alert_id: string
          status?: Database["public"]["Enums"]["notification_status"]
          threshold_usd: number
          trigger_price_usd: number
          user_id: string
        }
        Update: {
          activation_version?: number
          alert_id?: string | null
          coin_id?: string
          coin_name?: string
          coin_symbol?: string
          created_at?: string
          delivery_attempts?: number
          direction?: Database["public"]["Enums"]["alert_direction"]
          first_attempt_at?: string | null
          id?: string
          last_error?: string | null
          recipient_email?: string
          resend_email_id?: string | null
          sent_at?: string | null
          source_alert_id?: string
          status?: Database["public"]["Enums"]["notification_status"]
          threshold_usd?: number
          trigger_price_usd?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_coin_id_fkey"
            columns: ["coin_id"]
            isOneToOne: false
            referencedRelation: "coins"
            referencedColumns: ["id"]
          },
        ]
      }
      prices: {
        Row: {
          coin_id: string
          fetched_at: string
          price_usd: number
          provider_updated_at: string | null
        }
        Insert: {
          coin_id: string
          fetched_at?: string
          price_usd: number
          provider_updated_at?: string | null
        }
        Update: {
          coin_id?: string
          fetched_at?: string
          price_usd?: number
          provider_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prices_coin_id_fkey"
            columns: ["coin_id"]
            isOneToOne: true
            referencedRelation: "coins"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          coin_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          coin_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          coin_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_coin_id_fkey"
            columns: ["coin_id"]
            isOneToOne: false
            referencedRelation: "coins"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_notification_deliveries: {
        Args: {
          p_limit?: number
          p_now?: string
          p_visibility_seconds?: number
        }
        Returns: {
          coin_name: string
          coin_symbol: string
          delivery_attempt: number
          direction: Database["public"]["Enums"]["alert_direction"]
          event_id: string
          message_id: number
          recipient_email: string
          threshold_usd: string
          trigger_price_usd: string
        }[]
      }
      claim_price_refresh: { Args: { p_user_id: string }; Returns: boolean }
      complete_notification_delivery: {
        Args: {
          p_event_id: string
          p_message_id: number
          p_resend_email_id: string
          p_sent_at?: string
        }
        Returns: boolean
      }
      fail_notification_delivery: {
        Args: {
          p_error: string
          p_event_id: string
          p_message_id: number
          p_now?: string
          p_retryable: boolean
        }
        Returns: string
      }
      finish_coin_sync: {
        Args: { p_sync_run_id: string }
        Returns: {
          active_count: number
          deactivated_count: number
        }[]
      }
      get_watched_coin_ids: { Args: never; Returns: Json }
      process_price_batch: {
        Args: { p_fetched_at: string; p_prices: Json }
        Returns: {
          events_created: number
          prices_updated: number
        }[]
      }
      search_coins: {
        Args: { search_query: string }
        Returns: {
          coingecko_url: string
          id: string
          is_watched: boolean
          name: string
          symbol: string
        }[]
      }
    }
    Enums: {
      alert_direction: "above" | "below"
      notification_status: "pending" | "sending" | "sent" | "failed"
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
    Enums: {
      alert_direction: ["above", "below"],
      notification_status: ["pending", "sending", "sent", "failed"],
    },
  },
} as const

