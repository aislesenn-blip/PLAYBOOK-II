const SILICON_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const apiKey = "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

async function test() {
    console.log("Testing SiliconFlow API...");
    try {
        const response = await fetch(SILICON_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "meta-llama/Meta-Llama-3.1-70B-Instruct",
                messages: [{ role: "user", content: "Hello" }],
                max_tokens: 10
            })
        });
        console.log(response.status, await response.text());
    } catch (e) {
        console.error(e);
    }
}
test();
