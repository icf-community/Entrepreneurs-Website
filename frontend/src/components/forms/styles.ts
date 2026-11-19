// Shared form class names. One class each: the whole look of a field and of the caption above it lives in src/design-system/forms.css
// (.lm-field, .lm-label), so changing how every input in the product looks is a change there, not here.
//
// They stay strings because about fifteen files compose them (`${inputCls} resize-none`, `${labelCls} mb-2`) or pass them down as a prop.
// Utilities written after them still win: the family is in the components layer. New code should prefer <Input>, <Textarea>, <Select>
// (components/ui), which apply the same class and the invalid / compact states for you.
//
// inputCls  an <input>, <textarea>, <select> or a <button> that opens a list. 48 px, a firm edge that warms when pointed at and lights
//           when focused. The focus ring is the field's own edge; the global ring is retired for fields, so never add a second one.
// labelCls  the caption above a control: sentence case, small, medium weight, secondary ink. (It used to be tracked capitals.)
export const inputCls = "lm-field";
export const labelCls = "lm-label";
