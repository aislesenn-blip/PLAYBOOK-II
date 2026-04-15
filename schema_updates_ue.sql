-- Create the Knowledge Graphs table
CREATE TABLE public.knowledge_graphs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    domain VARCHAR(255) NOT NULL,
    concept_id VARCHAR(100) UNIQUE NOT NULL,
    canonical_name VARCHAR(255) NOT NULL,
    golden_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (Read-only for Execution Engine)
ALTER TABLE public.knowledge_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access for Execution Engine"
ON public.knowledge_graphs FOR SELECT USING (true);
