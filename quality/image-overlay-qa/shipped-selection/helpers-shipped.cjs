// Extracted unchanged from verified shipped0.2.7; evaluated in the documented VM harness.
function selectionRecipe(p, mode = 'add') {
  return p.settings.manualSelection ? clone(p.settings.manualSelection) : { version: 1, sourceRevision: sourceRevisionOf(p), base: mode === 'subtract' ? 'all' : 'none', inverted: false, feather: Number($('selectionFeather').value || 0) / 100, commands: [] };
}
function selectionWithDraft(draft) {
  const recipe = clone(draft.recipe), command = clone(draft.command);
  // Commands operate before the recipe inversion; the visible add/subtract choice does not.
  if (recipe.inverted) command.mode = command.mode === 'add' ? 'subtract' : 'add';
  recipe.commands.push(command); return recipe;
}
