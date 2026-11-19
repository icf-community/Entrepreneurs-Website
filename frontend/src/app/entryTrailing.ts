// A list row (Entry) whose trailing slot holds two buttons, as on /my-submissions and /my-activity.
//
// Beside the words the pair needs about 255 px, which a row of 640 px or more has and a phone's does not. So from md up the buttons sit at the
// right of the row, level with its title; below md the trailing slot (the Entry's third child) drops to a second row of the grid, in the
// words' own column, and may wrap. The Entry is a three-column grid (glyph, words, trailing); on a phone it is two.
export const STACK_TRAILING =
  "max-md:grid-cols-[auto_minmax(0,1fr)] max-md:[&>:nth-child(3)]:col-start-2 max-md:[&>:nth-child(3)]:mt-3 max-md:[&>:nth-child(3)]:flex-wrap";
