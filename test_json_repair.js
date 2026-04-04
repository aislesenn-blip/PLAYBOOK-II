const fs = require('fs');
const content = fs.readFileSync('js/ai.js', 'utf8');

// evaluate the repair logic using Function constructor
// First extract the repair logic
const start = content.indexOf('// Stack-based fallback mechanism');
const end = content.indexOf('} catch (e2) {', start);
const repairLogic = content.substring(start, end) + 'return parsedData;';

// Make a wrapper function
const repairFunc = new Function('content', `
    let parsedData;
    ${repairLogic}
`);

const testCases = [
    { name: "Valid JSON", input: '{"a": 1, "b": {"c": [1, 2, 3]}}', expectThrow: false },
    { name: "Truncated array", input: '{"questions": [{"id": 1}', expectThrow: false },
    { name: "Truncated object", input: '{"questions": [{"id": 1, "text": "a', expectThrow: false },
    { name: "Truncated key", input: '{"questions": [{"id": 1, "te', expectThrow: false },
    { name: "Truncated after comma", input: '{"questions": [{"id": 1,', expectThrow: false },
    { name: "Truncated inside string with comma", input: '{"questions": [{"id": 1, "text": "A, B', expectThrow: false }
];

let allPassed = true;

for (const tc of testCases) {
    try {
        let result = tc.input;
        try {
            JSON.parse(tc.input);
        } catch(e) {
            result = repairFunc(tc.input);
        }

        console.log(`Test ${tc.name}: Success`);
        console.log(`  Input: ${tc.input}`);
        console.log(`  Repaired: ${JSON.stringify(result)}`);
    } catch (e) {
        if (!tc.expectThrow) {
            console.error(`Test ${tc.name}: Failed! Unexpected throw: ${e.message}`);
            allPassed = false;
        } else {
            console.log(`Test ${tc.name}: Success (threw as expected)`);
        }
    }
}

if (!allPassed) process.exit(1);
console.log("All tests passed!");
