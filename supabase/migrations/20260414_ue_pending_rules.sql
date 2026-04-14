-- Add the Pending Rules Table for the Human-Assisted RAG Feedback Loop
CREATE TABLE public.ue_pending_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    target_node TEXT NOT NULL,
    suggested_synonym TEXT NOT NULL,
    ai_justification TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ue_pending_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for rule owners" ON public.ue_pending_rules FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sessions s JOIN public.courses c ON s.course_id = c.id WHERE ue_pending_rules.session_id = s.id AND c.professor_id = auth.uid())
);

CREATE POLICY "Enable update access for rule owners" ON public.ue_pending_rules FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sessions s JOIN public.courses c ON s.course_id = c.id WHERE ue_pending_rules.session_id = s.id AND c.professor_id = auth.uid())
);
