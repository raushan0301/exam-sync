describe('export-worker skeleton', () => {
  it('module loads without throwing', () => {
    expect(() => require('./index')).not.toThrow();
  });
});
