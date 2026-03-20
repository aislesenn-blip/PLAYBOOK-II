import os
import glob
from bs4 import BeautifulSoup

# Files to update top nav logic in
files_to_update = glob.glob("*.html")

for filepath in files_to_update:
    with open(filepath, 'r') as f:
        content = f.read()

    soup = BeautifulSoup(content, 'html.parser')

    nav = soup.find('nav', class_='top-nav')
    if not nav:
        continue

    nav_links = nav.find('ul', class_='nav-links')
    if not nav_links:
        continue

    # Add mobile sign out to the end of the ul if it's not there
    mobile_signout = soup.new_tag('li', attrs={'class': 'mobile-signout-li', 'style': 'display: none;'}) # will show on mobile via css, but since we are modifying dom, let's just make it a standard LI that is styled by our new CSS
    a_tag = soup.new_tag('a', href='#', id='mobile-signout-btn', attrs={'class': 'mobile-signout'})
    a_tag.string = 'Sign Out'
    mobile_signout.append(a_tag)

    # Let's remove any existing mobile signouts just in case
    for m in nav_links.find_all('li', class_='mobile-signout-li'):
        m.decompose()

    nav_links.append(mobile_signout)

    with open(filepath, 'w') as f:
        f.write(str(soup))
