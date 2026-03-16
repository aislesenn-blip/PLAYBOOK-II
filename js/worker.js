// Web Worker for Background Playbook Processing
// This prevents browser throttling in inactive tabs and enables real-time UI updates.

importScripts('ai.js');

self.onmessage = async function(e) {
    const { type, payload } = e.data;

    if (type === 'START_GRADING') {
        const { studentExams, markingSchemeText, sessionId, apiKey } = payload;

        try {
            for (let i = 0; i < studentExams.length; i++) {
                // Post progress start for this specific student
                self.postMessage({
                    type: 'PROGRESS_UPDATE',
                    payload: {
                        studentIndex: i,
                        totalStudents: studentExams.length,
                        status: 'Grading...'
                    }
                });

                const pages = studentExams[i];

                // Call the Playbook (which is now accessible via self.PlaybookAI due to importScripts)
                const gradingResult = await self.PlaybookAI.analyzeExamWithAI(pages, markingSchemeText, apiKey);

                const studentData = {
                    id: `${sessionId}-${i}`,
                    sessionId: sessionId,
                    studentName: gradingResult.studentName || `Student ${i+1}`,
                    registrationNumber: gradingResult.registrationNumber || 'Unknown ID',
                    pages: pages,
                    grading: gradingResult
                };

                // Post the completed student back to the main thread immediately
                self.postMessage({
                    type: 'STUDENT_GRADED',
                    payload: {
                        studentData: studentData,
                        studentIndex: i,
                        totalStudents: studentExams.length
                    }
                });
            }

            // All done
            self.postMessage({
                type: 'ALL_DONE',
                payload: {
                    sessionId: sessionId
                }
            });

        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                payload: { message: error.message }
            });
        }
    }
};