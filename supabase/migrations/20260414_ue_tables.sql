-- Create UE specific tables
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.ue_knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic TEXT NOT NULL,
    source_url TEXT,
    content_chunk TEXT NOT NULL,
    embedding vector(768), -- Assuming Gemini embedding size
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.ue_golden_schemes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    golden_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.ue_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ue_golden_schemes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all authenticated users" ON public.ue_knowledge_base FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable write access for all authenticated users" ON public.ue_knowledge_base FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable read access for scheme owners" ON public.ue_golden_schemes FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sessions s JOIN public.courses c ON s.course_id = c.id WHERE ue_golden_schemes.session_id = s.id AND c.professor_id = auth.uid())
);
CREATE POLICY "Enable write access for scheme owners" ON public.ue_golden_schemes FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.sessions s JOIN public.courses c ON s.course_id = c.id WHERE ue_golden_schemes.session_id = s.id AND c.professor_id = auth.uid())
);
CREATE POLICY "Enable update access for scheme owners" ON public.ue_golden_schemes FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sessions s JOIN public.courses c ON s.course_id = c.id WHERE ue_golden_schemes.session_id = s.id AND c.professor_id = auth.uid())
);
