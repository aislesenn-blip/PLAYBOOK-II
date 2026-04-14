// Standalone extraction helpers for UE to avoid relying on functions that might not be exported globally in PlaybookAI

async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;

    if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let extractedText = "";

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        extractedText += pageText + "\n";
    }

    // If it's a scanned PDF and text is empty, we must fallback to OCR (Gemini Vision)
    if (extractedText.trim().length < 50) {
        throw new Error("PDF seems to be scanned (no native text). Please ensure marking schemes are digital text or use the main upload OCR flow.");
    }

    return extractedText;
}

async function extractTextFromWord(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
}

// Minimal chunked extraction for students
async function extractStudentExamsUE(apiKey, file) {
    // For local UE testing, we do a basic text extract to simulate OCR if it's digital
    // If it's scanned, we need OCR.
    // To match Playbook's standard, we simulate the structure
    const rawText = await extractTextFromPDF(file);

    // Naively chunk by "Question" for simulation
    const questions = [];
    const parts = rawText.split(/(?=(?:Question|Q)\s*\d+)/gi);

    parts.forEach((p, idx) => {
        if(p.trim().length > 10) {
            questions.push({
                questionId: `Q_Extracted_${idx}`,
                text: p.trim()
            });
        }
    });

    return [{
        student_id: "Extracted_Student",
        student_id_uuid: null,
        questions: questions
    }];
}

window.UEExtractors = {
    extractTextFromPDF,
    extractTextFromWord,
    extractStudentExamsUE
};
