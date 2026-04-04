// js/db.js
// Supabase Client Initialization and Data Access Layer



const SUPABASE_URL = 'https://jlloehfeqjrkxeoqvmfk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbG9laGZlcWpya3hlb3F2bWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NDE3ODIsImV4cCI6MjA4OTMxNzc4Mn0.R_-BUSmRP9EF2Jdrhi9J2dm3OOLhpm-NJSbS3PA_ywg';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PlaybookDB = {
    // 1. INSTITUTIONS
    async getInstitution(id) {
        const { data, error } = await supabaseClient
            .from('institutions')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async getCourse(id) {
        const { data, error } = await supabaseClient
            .from('courses')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async getEnrolledStudents(courseId) {
        const { data, error } = await supabaseClient
            .from('class_enrollments')
            .select('*, student:students(*)')
            .eq('course_id', courseId);
        if (error) throw error;
        return data;
    },

    async getSessionsForCourse(courseId) {
        const { data, error } = await supabaseClient
            .from('sessions')
            .select('*')
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async saveInstitution(institution) {
        const { error } = await supabaseClient
            .from('institutions')
            .upsert(institution);
        if (error) throw error;
    },

    async publishSession(sessionId) {
        const { error } = await supabaseClient
            .from('sessions')
            .update({ publish_status: 'published' })
            .eq('id', sessionId);
        if (error) throw error;
    },

    // 1.5 SECURE INSTITUTION SECRETS (API KEYS)
    async getInstitutionSecret(institutionId) {
        // Only admins can query this table directly due to RLS.
        const { data, error } = await supabaseClient
            .from('institution_secrets')
            .select('openrouter_api_key')
            .eq('institution_id', institutionId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') { // no rows returned
                return null;
            }
            throw error;
        }
        return data;
    },

    async saveInstitutionSecret(institutionId, apiKey) {
        const { error } = await supabaseClient
            .from('institution_secrets')
            .upsert({ institution_id: institutionId, openrouter_api_key: apiKey });
        if (error) throw error;
    },

    // 2. USERS
    async getUserById(id) {
        const { data, error } = await supabaseClient
            .from('users')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async getUsersByInstitution(institutionId) {
        const { data, error } = await supabaseClient
            .from('users')
            .select('*')
            .eq('institution_id', institutionId);
        if (error) throw error;
        return data;
    },



    // 2.5 COURSES
    async getCourses() {
        // Fetch definitively based on auth token instead of localstorage since RLS depends on auth.uid()
        const { data: authData, error: authErr } = await supabaseClient.auth.getUser();
        if (authErr || !authData?.user?.id) return [];
        const userId = authData.user.id;

        const { data, error } = await supabaseClient
            .from('courses')
            .select('*')
            .eq('professor_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getCourseMaterials(courseId) {
        const { data, error } = await supabaseClient
            .from('course_materials')
            .select('*')
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async saveCourseMaterial(material) {
        const { data, error } = await supabaseClient
            .from('course_materials')
            .insert([material])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async createCourse(course) {
        const { data, error } = await supabaseClient
            .from('courses')
            .insert([course])
            .select()
            .single();
        if (error) throw error;
        return data;
    },


    // 3. SESSIONS (EXAMS)
    async getSessions() {
        const { data, error } = await supabaseClient
            .from('sessions')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getSession(id) {
        const { data, error } = await supabaseClient
            .from('sessions')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async saveSession(session) {
        const { data, error } = await supabaseClient
            .from('sessions')
            .upsert(session)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    // 4. EXAM SUBMISSIONS (STUDENTS)
    async getSubmissionsBySession(sessionId) {
        const { data, error } = await supabaseClient
            .from('exam_submissions')
            .select('*')
            .eq('session_id', sessionId);
        if (error) throw error;
        // Map backend schema to frontend expectation
        return data.map(sub => ({
            id: sub.id,
            studentName: sub.student_name,
            registrationNumber: sub.registration_number,
            text_content: sub.text_content,
            status: sub.status,
            grading: sub.grading_data ? {
                totalScore: sub.total_score,
                maxScore: sub.max_score,
                questions: sub.grading_data.questions
            } : null
        }));
    },

    async getSubmission(id) {
        const { data, error } = await supabaseClient
            .from('exam_submissions')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async saveSubmission(submission) {
        const { data, error } = await supabaseClient
            .from('exam_submissions')
            .upsert(submission)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    // 5. SETTINGS (using localStorage temporarily for user specific non-relational settings like scale)
    async getSetting(key) {
        const val = localStorage.getItem(`playbook_setting_${key}`);
        return val ? JSON.parse(val) : null;
    },

    async saveSetting(settingData) {
        localStorage.setItem(`playbook_setting_${settingData.id}`, JSON.stringify(settingData));
    }
};

window.PlaybookDB = PlaybookDB;
window.supabaseClient = supabaseClient;
