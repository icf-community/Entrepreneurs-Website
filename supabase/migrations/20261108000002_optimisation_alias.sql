-- The "Optimization" skill-directory concept was only aliased to its exact
-- American spelling, so "optimisation experience" fell through grammar.parse
-- to the model with no candidate concept — an unmatched British spelling,
-- not a genuine typo, so a reviewed exact alias is the right fix (concepts.py:
-- "no fuzzy grounding", but a British/American spelling pair is exactly what
-- the existing reviewed-alias mechanism is for, same as scikit-learn/sklearn).
update ai_private.concepts
   set aliases = array_append(aliases, 'optimisation')
 where slug = 'optimization'
   and not ('optimisation' = any(aliases));

-- Same gap, same fix: "data visualization" had no UK-spelling alias either.
update ai_private.concepts
   set aliases = array_append(aliases, 'data visualisation')
 where slug = 'data-visualization'
   and not ('data visualisation' = any(aliases));
