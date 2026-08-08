(() => {
  const status = (message) => { const node = document.getElementById('spikeStatus'); if (node) node.textContent = message; };
  const author = () => ({ kind: 'user', id: 'local-reviewer', displayName: localStorage.getItem('pitch.review.authorName') || 'Reviewer' });
  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-approval-revoke]') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const approvalId = button.getAttribute('data-approval-revoke');
    if (!approvalId) return;
    try {
      const current = await fetch('/api/review-state').then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || response.statusText);
        return value;
      });
      const response = await fetch('/api/review-command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'revokeApproval', approvalId, author: author(), expectedDeckHash: current.deckHash, expectedReviewHash: current.reviewHash }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || response.statusText);
      status(`Review · ${value.commandReason || 'Approval revoked'}`);
      window.dispatchEvent(new CustomEvent('pitch:editor-state', { detail: { source: 'review-governance' } }));
    } catch (error) {
      status(`Review revoke failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, true);
})();
