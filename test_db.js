const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://jlloehfeqjrkxeoqvmfk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbG9laGZlcWpya3hlb3F2bWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NDE3ODIsImV4cCI6MjA4OTMxNzc4Mn0.R_-BUSmRP9EF2Jdrhi9J2dm3OOLhpm-NJSbS3PA_ywg';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
    // 1. Fetch sessions
    const { data: sessions, error: sErr } = await supabase.from('sessions').select('*');
    console.log("Sessions:", sessions ? sessions.length : sErr);

    if (sessions && sessions.length > 0) {
        // 2. Fetch submissions
        const { data: subs, error: subErr } = await supabase.from('exam_submissions').select('*').eq('session_id', sessions[0].id);
        console.log("Submissions for session 1:", subs ? subs.length : subErr);

        if (subs && subs.length > 0) {
            console.log("Sample sub:", subs[0]);
        }
    } else {
        // Test fetching all subs
        const { data: allSubs, error: allErr } = await supabase.from('exam_submissions').select('*');
        console.log("All submissions:", allSubs ? allSubs.length : allErr);
        if (allErr) console.error(allErr);
    }
}

test();
