// js/db.js
// Supabase Client Initialization and Data Access Layer

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const PlaybookDB = {
    // 1. INSTITUTIONS
    async getInstitution(id) {
        const { data, error } = await supabase
            .from('institutions')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async saveInstitution(institution) {
        const { error } = await supabase
            .from('institutions')
            .upsert(institution);
        if (error) throw error;
    },

    // 2. USERS
    async getUserById(id) {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async getUsersByInstitution(institutionId) {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('institution_id', institutionId);
        if (error) throw error;
        return data;
    },

    // 3. SESSIONS (EXAMS)
    async getSessions() {
        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getSession(id) {
        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async saveSession(session) {
        const { data, error } = await supabase
            .from('sessions')
            .upsert(session)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    // 4. EXAM SUBMISSIONS (STUDENTS)
    async getSubmissionsBySession(sessionId) {
        const { data, error } = await supabase
            .from('exam_submissions')
            .select('*')
            .eq('session_id', sessionId);
        if (error) throw error;
        // Map backend schema to frontend expectation
        return data.map(sub => ({
            id: sub.id,
            studentName: sub.student_name,
            registrationNumber: sub.registration_number,
            grading: sub.grading_data ? {
                totalScore: sub.total_score,
                maxScore: sub.max_score,
                questions: sub.grading_data.questions
            } : null
        }));
    },

    async getSubmission(id) {
        const { data, error } = await supabase
            .from('exam_submissions')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    async saveSubmission(submission) {
        const { data, error } = await supabase
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
