// PermForge Documentation & Landing Interactive Script

document.addEventListener('DOMContentLoaded', () => {
  initTerminalTabs();
  initCliSearchAndFilter();
  initMcpTabs();
  initCopyButtons();
});

// Toast notification helper
function showToast(message = 'Copied to clipboard!') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> ${message}`;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

// Global copy to clipboard function
window.copyText = function(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast();
    }).catch(err => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
};

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showToast();
  } catch (err) {
    console.error('Fallback copy failed', err);
  }
  document.body.removeChild(textArea);
}

// Terminal tab switcher
function initTerminalTabs() {
  const tabs = document.querySelectorAll('.terminal-tab');
  const panes = document.querySelectorAll('.term-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPaneId = tab.getAttribute('data-pane');
      
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(targetPaneId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

// CLI Search and Tag Filters
function initCliSearchAndFilter() {
  const searchInput = document.getElementById('cliSearch');
  const tagButtons = document.querySelectorAll('.tag-btn');
  const cliCards = document.querySelectorAll('.cli-card');

  let currentTag = 'all';
  let searchQuery = '';

  function filterCards() {
    cliCards.forEach(card => {
      const name = (card.getAttribute('data-name') || '').toLowerCase();
      const tags = (card.getAttribute('data-tag') || '').toLowerCase();
      const desc = (card.querySelector('.cli-desc')?.textContent || '').toLowerCase();

      const matchesTag = (currentTag === 'all' || tags.includes(currentTag));
      const matchesSearch = !searchQuery || name.includes(searchQuery) || desc.includes(searchQuery) || tags.includes(searchQuery);

      if (matchesTag && matchesSearch) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      filterCards();
    });
  }

  tagButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tagButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTag = btn.getAttribute('data-filter').toLowerCase();
      filterCards();
    });
  });
}

// MCP Configuration Tabs
function initMcpTabs() {
  const mcpTabBtns = document.querySelectorAll('.mcp-tab-btn');
  const mcpPanes = document.querySelectorAll('.mcp-pane');

  mcpTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');

      mcpTabBtns.forEach(b => b.classList.remove('active'));
      mcpPanes.forEach(p => p.style.display = 'none');

      btn.classList.add('active');
      const activePane = document.getElementById(targetId);
      if (activePane) {
        activePane.style.display = 'block';
      }
    });
  });
}

// Copy Buttons Initializer
function initCopyButtons() {
  document.querySelectorAll('.copy-btn, .copy-btn-sm').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const textToCopy = btn.getAttribute('data-copy');
      if (textToCopy) {
        window.copyText(textToCopy);
      }
    });
  });
}
