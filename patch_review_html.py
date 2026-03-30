from bs4 import BeautifulSoup
import re

with open("review.html", "r") as f:
    soup = BeautifulSoup(f.read(), "html.parser")

# Ensure .grading-header class is on the question header div
# In review.js, it generates the HTML dynamically. We need to check review.js.
