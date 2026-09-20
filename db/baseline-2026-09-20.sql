-- baseline-2026-09-20: the complete application schema plus reference data, as of the cutover.
--
-- GENERATED, then reviewed by hand. Do not edit after release: the runner checksums it.
-- Source: the documented migration order (see baseline/README.md) applied to an empty database, plus
-- `activity_log`, which application code used to create lazily and no migration ever defined.
-- Historical SQL (root ksef-schema-migration*.sql, migrations/*) is archive material and is NOT run.
-- Reference data: business_days only. It is seeded through 2028-12-31 and MUST be extended before then.
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15


--
-- Name: next_business_day(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_business_day(from_date date) RETURNS date
    LANGUAGE plpgsql
    AS $$
DECLARE
    check_date DATE := from_date + 1;
    max_date DATE := from_date + 60;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM business_days WHERE date = check_date AND is_business_day = true
    ) LOOP
        check_date := check_date + 1;
        IF check_date > max_date THEN
            RAISE EXCEPTION 'next_business_day(%): no business day found within 60 days - business_days is likely empty or its seeded range has been exhausted (see ksef-holidays-init.sql)', from_date;
        END IF;
    END LOOP;
    RETURN check_date;
END;
$$;




--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id integer NOT NULL,
    firm_id integer NOT NULL,
    event_type character varying(50) NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    client_nip character varying(10),
    action character varying(50) NOT NULL,
    workflow_name character varying(100),
    execution_id character varying(255),
    details jsonb,
    success boolean NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    firm_id integer
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: auth_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_rate_limits (
    scope character varying(40) NOT NULL,
    subject_hash character varying(64) NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 1 NOT NULL
);


--
-- Name: business_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_days (
    date date NOT NULL,
    is_business_day boolean NOT NULL,
    holiday_name character varying(100)
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id integer NOT NULL,
    client_name character varying(512) NOT NULL,
    nip character varying(10) NOT NULL,
    auth_method character varying(20) NOT NULL,
    ksef_token_encrypted text,
    certificate_id character varying(255),
    certificate_expiry timestamp with time zone,
    permission_level character varying(50) DEFAULT 'read_write'::character varying NOT NULL,
    hwm_sales timestamp with time zone,
    hwm_purchases timestamp with time zone,
    last_sync_success timestamp with time zone,
    last_sync_error text,
    sync_enabled boolean DEFAULT true NOT NULL,
    contact_email character varying(255),
    contact_phone character varying(20),
    monthly_invoice_volume integer DEFAULT 0,
    preferred_session_mode character varying(20) DEFAULT 'interactive'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    firm_id integer,
    contact_person character varying(255),
    notes text,
    tags character varying(500),
    anonymized_at timestamp with time zone,
    street character varying(255),
    city character varying(255),
    postal_code character varying(10),
    tax_office_code text,
    taxpayer_type text DEFAULT 'company'::text NOT NULL,
    first_name text,
    last_name text,
    birth_date date,
    CONSTRAINT clients_auth_method_check CHECK (((auth_method)::text = ANY ((ARRAY['token'::character varying, 'certificate'::character varying])::text[]))),
    CONSTRAINT clients_preferred_session_mode_check CHECK (((preferred_session_mode)::text = ANY ((ARRAY['interactive'::character varying, 'batch'::character varying])::text[]))),
    CONSTRAINT clients_tax_office_code_check CHECK (((tax_office_code IS NULL) OR (tax_office_code ~ '^[0-9]{4}$'::text))),
    CONSTRAINT clients_taxpayer_type_check CHECK ((taxpayer_type = ANY (ARRAY['company'::text, 'individual'::text])))
);


--
-- Name: clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clients_id_seq OWNED BY public.clients.id;


--
-- Name: document_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_requests (
    id integer NOT NULL,
    firm_id integer NOT NULL,
    client_id integer NOT NULL,
    token character varying(64) NOT NULL,
    message text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: document_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_requests_id_seq OWNED BY public.document_requests.id;


--
-- Name: firm_imap_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firm_imap_settings (
    firm_id integer NOT NULL,
    host character varying(255) NOT NULL,
    port integer DEFAULT 993 NOT NULL,
    username character varying(255) NOT NULL,
    password_encrypted text NOT NULL,
    use_tls boolean DEFAULT true NOT NULL,
    mailbox character varying(255) DEFAULT 'INBOX'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT firm_imap_settings_port_check CHECK (((port >= 1) AND (port <= 65535)))
);


--
-- Name: firm_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firm_users (
    id integer NOT NULL,
    firm_id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(255),
    role character varying(20) DEFAULT 'member'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    reset_token character varying(64),
    reset_token_expires_at timestamp with time zone
);


--
-- Name: firm_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.firm_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: firm_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.firm_users_id_seq OWNED BY public.firm_users.id;


--
-- Name: firms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firms (
    id integer NOT NULL,
    firm_name character varying(512) NOT NULL,
    firm_nip character varying(10),
    slug character varying(100) NOT NULL,
    subscription_tier character varying(20) DEFAULT 'start'::character varying NOT NULL,
    max_clients integer DEFAULT 15 NOT NULL,
    admin_email character varying(255) NOT NULL,
    admin_password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    trial_expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    onboarding_complete boolean DEFAULT false NOT NULL,
    reset_token character varying(64),
    reset_token_expires_at timestamp with time zone,
    stripe_customer_id character varying(255),
    stripe_subscription_id character varying(255),
    subscription_status character varying(30) DEFAULT 'trial'::character varying,
    CONSTRAINT firms_subscription_status_check CHECK (((subscription_status)::text = ANY ((ARRAY['trial'::character varying, 'active'::character varying, 'past_due'::character varying, 'canceled'::character varying, 'paused'::character varying])::text[]))),
    CONSTRAINT firms_subscription_tier_check CHECK (((subscription_tier)::text = ANY ((ARRAY['start'::character varying, 'biznes'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[])))
);


--
-- Name: firms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.firms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: firms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.firms_id_seq OWNED BY public.firms.id;


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id integer NOT NULL,
    firm_id integer NOT NULL,
    email character varying(255) NOT NULL,
    token character varying(64) NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying,
    accepted boolean DEFAULT false,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invitations_id_seq OWNED BY public.invitations.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    client_nip character varying(10) NOT NULL,
    ksef_number character varying(40),
    invoice_number character varying(256),
    invoice_type character varying(20),
    direction character varying(10) NOT NULL,
    seller_nip character varying(20),
    seller_name character varying(512),
    buyer_nip character varying(20),
    buyer_name character varying(512),
    net_amount numeric(15,2),
    vat_amount numeric(15,2),
    gross_amount numeric(15,2),
    currency character varying(3) DEFAULT 'PLN'::character varying,
    issue_date date,
    delivery_date date,
    ksef_acquisition_date timestamp with time zone,
    ksef_permanent_storage_date timestamp with time zone,
    processing_status character varying(30) DEFAULT 'new'::character varying NOT NULL,
    cost_category character varying(100),
    vat_deductible boolean,
    classification_confidence numeric(3,2),
    jpk_marker character varying(10),
    jpk_period character varying(7),
    jpk_correction_needed boolean DEFAULT false,
    jpk_correction_done boolean DEFAULT false,
    raw_xml text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ksef_submission_date timestamp with time zone,
    invoice_lines jsonb,
    due_date date,
    payment_status character varying(20) DEFAULT 'unpaid'::character varying,
    paid_at timestamp with time zone,
    kpir_column character varying(5),
    vat_register_field character varying(10),
    firm_id integer NOT NULL,
    corrects_invoice_id integer,
    correction_reason text,
    upo_xml text,
    upo_reference_number character varying(64),
    upo_hash character varying(64),
    upo_retrieved_at timestamp with time zone,
    buyer_street character varying(255),
    buyer_city character varying(255),
    buyer_postal_code character varying(10),
    ksef_session_reference_number character varying(64),
    ksef_rejection_reason text,
    jpk_gtu text[] DEFAULT '{}'::text[] NOT NULL,
    jpk_procedures text[] DEFAULT '{}'::text[] NOT NULL,
    jpk_doc_type text,
    jpk_import boolean DEFAULT false NOT NULL,
    jpk_counterparty_country text,
    jpk_margin_gross numeric(14,2),
    jpk_margin_taxable_gross numeric(14,2),
    jpk_margin_vat_rate text,
    jpk_margin_method text,
    CONSTRAINT invoices_direction_check CHECK (((direction)::text = ANY ((ARRAY['sales'::character varying, 'purchase'::character varying])::text[]))),
    CONSTRAINT invoices_jpk_counterparty_country_check CHECK (((jpk_counterparty_country IS NULL) OR (jpk_counterparty_country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT invoices_jpk_doc_type_check CHECK (((jpk_doc_type IS NULL) OR (jpk_doc_type = ANY (ARRAY['RO'::text, 'WEW'::text, 'FP'::text, 'MK'::text, 'VAT_RR'::text])))),
    CONSTRAINT invoices_jpk_gtu_check CHECK ((jpk_gtu <@ ARRAY['GTU_01'::text, 'GTU_02'::text, 'GTU_03'::text, 'GTU_04'::text, 'GTU_05'::text, 'GTU_06'::text, 'GTU_07'::text, 'GTU_08'::text, 'GTU_09'::text, 'GTU_10'::text, 'GTU_11'::text, 'GTU_12'::text, 'GTU_13'::text])),
    CONSTRAINT invoices_jpk_margin_method_check CHECK (((jpk_margin_method IS NULL) OR (jpk_margin_method = ANY (ARRAY['individual'::text, 'sum'::text])))),
    CONSTRAINT invoices_jpk_margin_vat_rate_check CHECK (((jpk_margin_vat_rate IS NULL) OR (jpk_margin_vat_rate = ANY (ARRAY['5'::text, '8'::text, '23'::text])))),
    CONSTRAINT invoices_jpk_marker_check CHECK (((jpk_marker)::text = ANY ((ARRAY['NrKSeF'::character varying, 'OFF'::character varying, 'BFK'::character varying, 'DI'::character varying])::text[]))),
    CONSTRAINT invoices_jpk_procedures_check CHECK ((jpk_procedures <@ ARRAY['WSTO_EE'::text, 'IED'::text, 'TP'::text, 'TT_WNT'::text, 'TT_D'::text, 'MR_T'::text, 'MR_UZ'::text, 'I_42'::text, 'I_63'::text, 'B_SPV'::text, 'B_SPV_DOSTAWA'::text, 'B_MPV_PROWIZJA'::text])),
    CONSTRAINT invoices_processing_status_check CHECK (((processing_status)::text = ANY ((ARRAY['new'::character varying, 'classified'::character varying, 'sent'::character varying, 'rejected'::character varying, 'exported_jpk'::character varying, 'error'::character varying, 'duplicate'::character varying])::text[])))
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: jpk_preparations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jpk_preparations (
    id integer NOT NULL,
    client_nip character varying(10) NOT NULL,
    period character varying(7) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    total_invoices integer DEFAULT 0,
    nr_ksef_count integer DEFAULT 0,
    off_count integer DEFAULT 0,
    bfk_count integer DEFAULT 0,
    di_count integer DEFAULT 0,
    di_resolved_count integer DEFAULT 0,
    generated_at timestamp with time zone,
    exported_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    firm_id integer NOT NULL,
    export_data text,
    CONSTRAINT jpk_preparations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'ready'::character varying, 'exported'::character varying, 'correction_needed'::character varying])::text[])))
);


--
-- Name: jpk_preparations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jpk_preparations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jpk_preparations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jpk_preparations_id_seq OWNED BY public.jpk_preparations.id;


--
-- Name: jpk_test_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jpk_test_submissions (
    id integer NOT NULL,
    firm_id integer NOT NULL,
    client_nip character varying(20) NOT NULL,
    period character varying(7) NOT NULL,
    requested_by text NOT NULL,
    reference_number character varying(128),
    status character varying(20) NOT NULL,
    gateway_code integer,
    gateway_description text,
    gateway_details text,
    gateway_upo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT jpk_test_submissions_period_check CHECK (((period)::text ~ '^\\d{4}-\\d{2}$'::text)),
    CONSTRAINT jpk_test_submissions_status_check CHECK (((status)::text = ANY ((ARRAY['submitting'::character varying, 'processing'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'error'::character varying])::text[])))
);


--
-- Name: jpk_test_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jpk_test_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jpk_test_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jpk_test_submissions_id_seq OWNED BY public.jpk_test_submissions.id;


--
-- Name: ocr_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_queue (
    id integer NOT NULL,
    client_nip character varying(10) NOT NULL,
    source_type character varying(20) NOT NULL,
    file_path text NOT NULL,
    file_type character varying(10),
    ocr_status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    extracted_data jsonb,
    confidence_score numeric(3,2),
    matched_ksef_number character varying(40),
    error_message text,
    retry_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    firm_id integer NOT NULL,
    CONSTRAINT ocr_queue_ocr_status_check CHECK (((ocr_status)::text = ANY ((ARRAY['queued'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'manual_review'::character varying])::text[]))),
    CONSTRAINT ocr_queue_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['email'::character varying, 'upload'::character varying, 'webhook'::character varying])::text[])))
);


--
-- Name: ocr_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ocr_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ocr_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ocr_queue_id_seq OWNED BY public.ocr_queue.id;


--
-- Name: offline_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offline_invoices (
    id integer NOT NULL,
    client_nip character varying(10) NOT NULL,
    invoice_number character varying(256) NOT NULL,
    offline_mode character varying(20) NOT NULL,
    issue_timestamp timestamp with time zone NOT NULL,
    upload_deadline timestamp with time zone NOT NULL,
    uploaded_to_ksef boolean DEFAULT false,
    ksef_number character varying(40),
    upload_attempts integer DEFAULT 0,
    last_attempt_error text,
    alert_sent_4h boolean DEFAULT false,
    alert_sent_1h boolean DEFAULT false,
    alert_sent_overdue boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    firm_id integer NOT NULL,
    invoice_id integer,
    client_notified_4h boolean DEFAULT false,
    client_notified_1h boolean DEFAULT false,
    client_notified_overdue boolean DEFAULT false
);


--
-- Name: offline_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.offline_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: offline_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.offline_invoices_id_seq OWNED BY public.offline_invoices.id;


--
-- Name: operator_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_audit_log (
    id bigint NOT NULL,
    operator_id integer,
    operator_email character varying(255),
    action character varying(50) NOT NULL,
    firm_id integer,
    ip character varying(64),
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: operator_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.operator_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: operator_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.operator_audit_log_id_seq OWNED BY public.operator_audit_log.id;


--
-- Name: operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operators (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone
);


--
-- Name: operators_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.operators_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: operators_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.operators_id_seq OWNED BY public.operators.id;


--
-- Name: portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_sessions (
    id integer NOT NULL,
    firm_id integer NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: portal_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_sessions_id_seq OWNED BY public.portal_sessions.id;


--
-- Name: system_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_health (
    id integer NOT NULL,
    check_type character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    details jsonb,
    checked_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_health_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_health_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_health_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_health_id_seq OWNED BY public.system_health.id;


--
-- Name: zus_declaration_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zus_declaration_events (
    id bigint NOT NULL,
    declaration_id bigint NOT NULL,
    firm_id integer NOT NULL,
    event_type character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT zus_declaration_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['imported'::character varying, 'downloaded'::character varying])::text[])))
);


--
-- Name: zus_declaration_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zus_declaration_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zus_declaration_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zus_declaration_events_id_seq OWNED BY public.zus_declaration_events.id;


--
-- Name: zus_declarations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zus_declarations (
    id bigint NOT NULL,
    firm_id integer NOT NULL,
    client_nip character varying(20) NOT NULL,
    period character varying(7) NOT NULL,
    document_types text[] NOT NULL,
    source_filename character varying(255) NOT NULL,
    source_xml text NOT NULL,
    sha256 character(64) NOT NULL,
    status character varying(24) DEFAULT 'imported'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    exported_at timestamp with time zone,
    CONSTRAINT zus_declarations_document_types_check CHECK ((cardinality(document_types) > 0)),
    CONSTRAINT zus_declarations_period_check CHECK (((period)::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT zus_declarations_status_check CHECK (((status)::text = ANY ((ARRAY['imported'::character varying, 'ready_for_export'::character varying, 'exported'::character varying])::text[])))
);


--
-- Name: zus_declarations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zus_declarations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zus_declarations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zus_declarations_id_seq OWNED BY public.zus_declarations.id;


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public.clients_id_seq'::regclass);


--
-- Name: document_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests ALTER COLUMN id SET DEFAULT nextval('public.document_requests_id_seq'::regclass);


--
-- Name: firm_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_users ALTER COLUMN id SET DEFAULT nextval('public.firm_users_id_seq'::regclass);


--
-- Name: firms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms ALTER COLUMN id SET DEFAULT nextval('public.firms_id_seq'::regclass);


--
-- Name: invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations ALTER COLUMN id SET DEFAULT nextval('public.invitations_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: jpk_preparations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_preparations ALTER COLUMN id SET DEFAULT nextval('public.jpk_preparations_id_seq'::regclass);


--
-- Name: jpk_test_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_test_submissions ALTER COLUMN id SET DEFAULT nextval('public.jpk_test_submissions_id_seq'::regclass);


--
-- Name: ocr_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_queue ALTER COLUMN id SET DEFAULT nextval('public.ocr_queue_id_seq'::regclass);


--
-- Name: offline_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_invoices ALTER COLUMN id SET DEFAULT nextval('public.offline_invoices_id_seq'::regclass);


--
-- Name: operator_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_log ALTER COLUMN id SET DEFAULT nextval('public.operator_audit_log_id_seq'::regclass);


--
-- Name: operators id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators ALTER COLUMN id SET DEFAULT nextval('public.operators_id_seq'::regclass);


--
-- Name: portal_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessions ALTER COLUMN id SET DEFAULT nextval('public.portal_sessions_id_seq'::regclass);


--
-- Name: system_health id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_health ALTER COLUMN id SET DEFAULT nextval('public.system_health_id_seq'::regclass);


--
-- Name: zus_declaration_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declaration_events ALTER COLUMN id SET DEFAULT nextval('public.zus_declaration_events_id_seq'::regclass);


--
-- Name: zus_declarations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declarations ALTER COLUMN id SET DEFAULT nextval('public.zus_declarations_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_rate_limits auth_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_rate_limits
    ADD CONSTRAINT auth_rate_limits_pkey PRIMARY KEY (scope, subject_hash);


--
-- Name: business_days business_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_days
    ADD CONSTRAINT business_days_pkey PRIMARY KEY (date);


--
-- Name: clients clients_firm_id_nip_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_firm_id_nip_key UNIQUE (firm_id, nip);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: document_requests document_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_pkey PRIMARY KEY (id);


--
-- Name: document_requests document_requests_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_token_key UNIQUE (token);


--
-- Name: firm_imap_settings firm_imap_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_imap_settings
    ADD CONSTRAINT firm_imap_settings_pkey PRIMARY KEY (firm_id);


--
-- Name: firm_users firm_users_firm_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_users
    ADD CONSTRAINT firm_users_firm_id_email_key UNIQUE (firm_id, email);


--
-- Name: firm_users firm_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_users
    ADD CONSTRAINT firm_users_pkey PRIMARY KEY (id);


--
-- Name: firms firms_admin_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms
    ADD CONSTRAINT firms_admin_email_key UNIQUE (admin_email);


--
-- Name: firms firms_firm_nip_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms
    ADD CONSTRAINT firms_firm_nip_key UNIQUE (firm_nip);


--
-- Name: firms firms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms
    ADD CONSTRAINT firms_pkey PRIMARY KEY (id);


--
-- Name: firms firms_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms
    ADD CONSTRAINT firms_slug_key UNIQUE (slug);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: invoices invoices_ksef_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_ksef_number_key UNIQUE (ksef_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: jpk_preparations jpk_preparations_firm_client_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_preparations
    ADD CONSTRAINT jpk_preparations_firm_client_period_key UNIQUE (firm_id, client_nip, period);


--
-- Name: jpk_preparations jpk_preparations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_preparations
    ADD CONSTRAINT jpk_preparations_pkey PRIMARY KEY (id);


--
-- Name: jpk_test_submissions jpk_test_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_test_submissions
    ADD CONSTRAINT jpk_test_submissions_pkey PRIMARY KEY (id);


--
-- Name: ocr_queue ocr_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_queue
    ADD CONSTRAINT ocr_queue_pkey PRIMARY KEY (id);


--
-- Name: offline_invoices offline_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_invoices
    ADD CONSTRAINT offline_invoices_pkey PRIMARY KEY (id);


--
-- Name: operator_audit_log operator_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_log
    ADD CONSTRAINT operator_audit_log_pkey PRIMARY KEY (id);


--
-- Name: operators operators_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_email_key UNIQUE (email);


--
-- Name: operators operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_pkey PRIMARY KEY (id);


--
-- Name: portal_sessions portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessions
    ADD CONSTRAINT portal_sessions_pkey PRIMARY KEY (id);


--
-- Name: portal_sessions portal_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessions
    ADD CONSTRAINT portal_sessions_token_key UNIQUE (token);


--
-- Name: system_health system_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_health
    ADD CONSTRAINT system_health_pkey PRIMARY KEY (id);


--
-- Name: zus_declaration_events zus_declaration_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declaration_events
    ADD CONSTRAINT zus_declaration_events_pkey PRIMARY KEY (id);


--
-- Name: zus_declarations zus_declarations_firm_id_client_nip_period_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declarations
    ADD CONSTRAINT zus_declarations_firm_id_client_nip_period_sha256_key UNIQUE (firm_id, client_nip, period, sha256);


--
-- Name: zus_declarations zus_declarations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declarations
    ADD CONSTRAINT zus_declarations_pkey PRIMARY KEY (id);


--
-- Name: auth_rate_limits_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_rate_limits_window_idx ON public.auth_rate_limits USING btree (window_started_at);


--
-- Name: firm_users_reset_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX firm_users_reset_token_key ON public.firm_users USING btree (reset_token) WHERE (reset_token IS NOT NULL);


--
-- Name: idx_audit_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_client ON public.audit_log USING btree (client_nip, created_at);


--
-- Name: idx_clients_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_firm ON public.clients USING btree (firm_id);


--
-- Name: idx_document_requests_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_requests_token ON public.document_requests USING btree (token);


--
-- Name: idx_invoices_client_nip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_client_nip ON public.invoices USING btree (client_nip);


--
-- Name: idx_invoices_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_direction ON public.invoices USING btree (direction);


--
-- Name: idx_invoices_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_firm ON public.invoices USING btree (firm_id);


--
-- Name: idx_invoices_jpk_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_jpk_period ON public.invoices USING btree (jpk_period);


--
-- Name: idx_invoices_ksef_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_ksef_number ON public.invoices USING btree (ksef_number);


--
-- Name: idx_invoices_processing_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_processing_status ON public.invoices USING btree (processing_status);


--
-- Name: idx_jpk_preparations_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jpk_preparations_firm ON public.jpk_preparations USING btree (firm_id);


--
-- Name: idx_jpk_test_submissions_firm_client_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jpk_test_submissions_firm_client_created ON public.jpk_test_submissions USING btree (firm_id, client_nip, created_at DESC);


--
-- Name: idx_offline_invoices_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_invoices_firm ON public.offline_invoices USING btree (firm_id);


--
-- Name: idx_offline_invoices_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_invoices_invoice_id ON public.offline_invoices USING btree (invoice_id);


--
-- Name: idx_offline_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_pending ON public.offline_invoices USING btree (upload_deadline) WHERE (uploaded_to_ksef = false);


--
-- Name: idx_operator_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operator_audit_created ON public.operator_audit_log USING btree (created_at DESC);


--
-- Name: idx_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expires ON public.portal_sessions USING btree (expires_at);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_token ON public.portal_sessions USING btree (token);


--
-- Name: idx_zus_declaration_events_firm_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zus_declaration_events_firm_created ON public.zus_declaration_events USING btree (firm_id, created_at DESC);


--
-- Name: idx_zus_declarations_firm_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zus_declarations_firm_created ON public.zus_declarations USING btree (firm_id, created_at DESC);


--
-- Name: audit_log audit_log_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: clients clients_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: document_requests document_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: document_requests document_requests_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: firm_imap_settings firm_imap_settings_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_imap_settings
    ADD CONSTRAINT firm_imap_settings_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: firm_users firm_users_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_users
    ADD CONSTRAINT firm_users_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_corrects_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_corrects_invoice_id_fkey FOREIGN KEY (corrects_invoice_id) REFERENCES public.invoices(id);


--
-- Name: invoices invoices_firm_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_firm_client_fkey FOREIGN KEY (firm_id, client_nip) REFERENCES public.clients(firm_id, nip);


--
-- Name: invoices invoices_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: jpk_preparations jpk_preparations_firm_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_preparations
    ADD CONSTRAINT jpk_preparations_firm_client_fkey FOREIGN KEY (firm_id, client_nip) REFERENCES public.clients(firm_id, nip);


--
-- Name: jpk_preparations jpk_preparations_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_preparations
    ADD CONSTRAINT jpk_preparations_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: jpk_test_submissions jpk_test_submissions_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jpk_test_submissions
    ADD CONSTRAINT jpk_test_submissions_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: ocr_queue ocr_queue_firm_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_queue
    ADD CONSTRAINT ocr_queue_firm_client_fkey FOREIGN KEY (firm_id, client_nip) REFERENCES public.clients(firm_id, nip);


--
-- Name: ocr_queue ocr_queue_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_queue
    ADD CONSTRAINT ocr_queue_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: offline_invoices offline_invoices_firm_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_invoices
    ADD CONSTRAINT offline_invoices_firm_client_fkey FOREIGN KEY (firm_id, client_nip) REFERENCES public.clients(firm_id, nip);


--
-- Name: offline_invoices offline_invoices_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_invoices
    ADD CONSTRAINT offline_invoices_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: offline_invoices offline_invoices_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_invoices
    ADD CONSTRAINT offline_invoices_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: operator_audit_log operator_audit_log_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_log
    ADD CONSTRAINT operator_audit_log_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: portal_sessions portal_sessions_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessions
    ADD CONSTRAINT portal_sessions_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: zus_declaration_events zus_declaration_events_declaration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declaration_events
    ADD CONSTRAINT zus_declaration_events_declaration_id_fkey FOREIGN KEY (declaration_id) REFERENCES public.zus_declarations(id) ON DELETE CASCADE;


--
-- Name: zus_declaration_events zus_declaration_events_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declaration_events
    ADD CONSTRAINT zus_declaration_events_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: zus_declarations zus_declarations_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zus_declarations
    ADD CONSTRAINT zus_declarations_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- Reference data: Polish business-day calendar
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15


--
-- Data for Name: business_days; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-02-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-03-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-07-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-06', false, 'Trzech Kroli');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-03', false, 'Swieto Konstytucji 3 Maja');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-06', false, 'Poniedzialek Wielkanocny');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-06-04', false, 'Boze Cialo');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-09-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-10-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-02-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-06', false, 'Trzech Kroli');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-01', false, 'Wszystkich Swietych');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-25', false, 'Boze Narodzenie (dzien 1)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-28', false, 'Wielkanoc (Niedziela Wielkanocna)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-04-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-06-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-07-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-09-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-10-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-03', false, 'Swieto Konstytucji 3 Maja');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-01', false, 'Wszystkich Swietych');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-16', false, 'Zeslanie Ducha Swietego');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-27', false, 'Boze Cialo');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-02-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-03-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-11', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-06', false, 'Trzech Kroli');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-03', false, 'Swieto Konstytucji 3 Maja');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-25', false, 'Boze Narodzenie (dzien 1)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-16', false, 'Wielkanoc (Niedziela Wielkanocna)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-04', false, 'Zeslanie Ducha Swietego');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-15', false, 'Boze Cialo');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-06-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-07-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-06', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-13', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-20', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-27', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-09-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-01', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-07', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-08', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-14', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-15', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-21', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-22', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-25', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-26', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-28', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-29', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-10-31', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-02', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-03', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-04', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-05', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-09', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-10', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-12', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-16', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-17', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-18', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-19', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-23', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-24', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-25', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-26', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-30', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-01', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-02', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-03', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-04', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-05', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-06', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-07', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-08', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-09', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-10', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-11', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-12', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-13', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-14', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-15', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-16', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-17', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-18', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-19', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-20', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-21', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-22', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-23', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-24', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-27', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-28', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-29', true, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-30', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-31', false, NULL);
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-01-01', false, 'Nowy Rok');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-01-01', false, 'Nowy Rok');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-01-01', false, 'Nowy Rok');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-01', false, 'Swieto Pracy');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-05-01', false, 'Swieto Pracy');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-05-01', false, 'Swieto Pracy');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-08-15', false, 'Wniebowziecie NMP');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-08-15', false, 'Wniebowziecie NMP');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-08-15', false, 'Wniebowziecie NMP');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-01', false, 'Wszystkich Swietych');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-11-11', false, 'Swieto Niepodleglosci');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-11-11', false, 'Swieto Niepodleglosci');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-11-11', false, 'Swieto Niepodleglosci');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-25', false, 'Boze Narodzenie (dzien 1)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-12-26', false, 'Boze Narodzenie (dzien 2)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-12-26', false, 'Boze Narodzenie (dzien 2)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-12-26', false, 'Boze Narodzenie (dzien 2)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-04-05', false, 'Wielkanoc (Niedziela Wielkanocna)');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2027-03-29', false, 'Poniedzialek Wielkanocny');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2028-04-17', false, 'Poniedzialek Wielkanocny');
INSERT INTO public.business_days (date, is_business_day, holiday_name) VALUES ('2026-05-24', false, 'Zeslanie Ducha Swietego');


--
-- PostgreSQL database dump complete
--


