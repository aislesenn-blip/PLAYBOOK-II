import re

with open("css/style.css", "r") as f:
    content = f.read()

# Replace the 768px media query block that increases sizes
# We will replace it with a block that scales sizes down or resets them.

# First, let's find the start and end of the @media (max-width: 768px) block.
start_idx = content.find("@media (max-width: 768px) {")

if start_idx != -1:
    # We want to replace this entire block.
    # The block ends when we encounter a '}' at the base indentation level.
    # A simple way to find the end is to count braces.
    end_idx = start_idx
    brace_count = 0
    in_block = False
    for i in range(start_idx, len(content)):
        if content[i] == '{':
            brace_count += 1
            in_block = True
        elif content[i] == '}':
            brace_count -= 1

        if in_block and brace_count == 0:
            end_idx = i + 1
            break

    # Let's remove this block completely, we will implement mobile-first or proper mobile styles in a new block.
    content = content[:start_idx] + content[end_idx:]

with open("css/style.css", "w") as f:
    f.write(content)
