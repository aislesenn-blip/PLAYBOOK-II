const fs = require('fs');

// Read the js/register.js file to extract the sanitizeDomain function
const code = fs.readFileSync('js/register.js', 'utf8');

// Extract the sanitizeDomain function string
const funcMatch = code.match(/function sanitizeDomain[\s\S]*?\n\}/);
if (funcMatch) {
  // Evaluate the function in this scope
  eval(funcMatch[0]);

  const testCases = [
    { input: " play.com ", expected: "play.com" },
    { input: " @play.com", expected: "play.com" },
    { input: "http://play.com", expected: "play.com" },
    { input: "https://www.play.com", expected: "play.com" },
    { input: "@www.play.com", expected: "play.com" },
    { input: "https://@play.com", expected: "play.com" },
    { input: "PLAY.COM", expected: "play.com" },
    { input: "  https://www.@play.com  ", expected: "play.com" },
    { input: "https://play.com/path/to", expected: "play.com" }
  ];

  let failed = false;
  for (const tc of testCases) {
    const result = sanitizeDomain(tc.input);
    if (result !== tc.expected) {
      console.error(`FAIL: input "${tc.input}", expected "${tc.expected}", got "${result}"`);
      failed = true;
    } else {
      console.log(`PASS: input "${tc.input}" -> "${result}"`);
    }
  }

  if (failed) {
    process.exit(1);
  } else {
    console.log("All tests passed!");
  }
} else {
  console.error("Could not find sanitizeDomain in js/register.js");
  process.exit(1);
}
