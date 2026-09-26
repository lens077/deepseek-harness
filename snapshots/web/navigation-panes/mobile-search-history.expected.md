# Touch session actions

- menu:
  - menuitem "Unpin":
    - img
    - text: Unpin
  - menuitem "Rename":
    - img
    - text: Rename
  - menuitem "Duplicate as sibling session":
    - img
    - text: Duplicate as sibling session
  - menuitem "New nested child session":
    - img
    - text: New nested child session
  - menuitem "Manage session directories":
    - img
    - text: Manage session directories
  - menuitem "Archive session":
    - img
    - text: Archive session
  - menuitem "Permanently delete session":
    - img
    - text: Permanently delete session

# Phone question history

- dialog "Question history":
  - img
  - textbox "Search questions"
  - button "Close":
    - img
  - button "Select"
  - 'button "1 NavScenario: first run bash to print exactly NAVIGATION_OK, then read nav-a.md and nav-b.md using two read calls in ONE assistant message, then reply with the single word FIRST_DONE and stop. {{clock}}"':
    - text: "1 NavScenario: first run bash to print exactly NAVIGATION_OK, then read nav-a.md and nav-b.md using two read calls in ONE assistant message, then reply with the single word FIRST_DONE and stop."
    - time: {{clock}}
  - button "Remove this question from context":
    - img
  - 'button "2 Reply in markdown with: a level-2 heading \"Navigation Summary\", a bulleted list of exactly two items, and a fenced code block containing echo WATERFALL. Then stop. {{clock}}"':
    - text: "2 Reply in markdown with: a level-2 heading \"Navigation Summary\", a bulleted list of exactly two items, and a fenced code block containing echo WATERFALL. Then stop."
    - time: {{clock}}
  - button "Remove this question from context":
    - img
