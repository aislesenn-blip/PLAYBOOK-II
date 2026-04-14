const { UEGraphExecutor } = require('../js/ue_engine.js');

const goldenJSON = {
    "questions": {
        "Q1_A_ii": {
            "title": "Beneficial Nutrients",
            "type": "logic",
            "nodes": [
                { "concept": "NOT_ESSENTIAL", "weight": 0.25, "synonyms": ["do not meet criteria of essentiality"] },
                { "concept": "BENEFICIAL", "weight": 0.25, "synonyms": ["play beneficial roles"] }
            ],
            "fatal_contradictions": ["Are essential", "IS_ESSENTIAL"],
            "total_marks": 0.5
        },
        "Q3_B": {
            "title": "Reasons to Adopt PF",
            "type": "logic",
            "nodes": [
                { "concept": "Reduce Drudgery", "weight": 2.0, "synonyms": ["easy to manage"] }
            ],
            "total_marks": 10
        }
    }
};

const studentAnswers = {
    "Q1_A_ii": {
        "questionId": "Q1_A_ii",
        "questionTitle": "Beneficial Nutrients",
        "text": "Are essential or important nutrients which are required for growth."
    },
    "Q3_B": {
        "questionId": "Q3_B",
        "questionTitle": "Reasons to Adopt PF",
        "text": "Easy / Reliable way to manage large farms."
    },
    "Q_BLANK": {
        "questionId": "Q_BLANK",
        "questionTitle": "Missing Answer",
        "text": "No text extracted."
    }
};

const executor = new UEGraphExecutor(goldenJSON);
const result = executor.execute(studentAnswers);

const mockSubmission = {
    grading_data: {
        questions: Object.values(studentAnswers).map(q => {
            const bd = result.breakdown[q.questionId] || {};
            return {
                questionId: q.questionId,
                questionTitle: bd.title || `Question ${q.questionId}`,
                raw_answer: q.text,
                points_awarded: bd.points_awarded || [],
                marks_awarded_by_ai: bd.score || 0,
                max_marks: bd.max_marks || 1,
                justification: bd.justification || "No justification generated.",
                constructive_feedback: bd.feedback || "No feedback generated.",
                answer_status: bd.answer_status || "Answered",
                is_entirely_blank: bd.is_entirely_blank || false
            };
        })
    }
};

console.log(JSON.stringify(mockSubmission, null, 2));
