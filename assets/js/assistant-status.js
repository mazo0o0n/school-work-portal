const refreshStatsButton = document.getElementById('refreshStats');
const loadStatus = document.getElementById('loadStatus');
const qaCount = document.getElementById('qaCount');
const sourcesCount = document.getElementById('sourcesCount');
const updatedAt = document.getElementById('updatedAt');
const fallbackNote = document.getElementById('fallbackNote');

function formatArabicDate(value){
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) throw new Error('Invalid update date');

  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(date);
}

async function loadKnowledgeStats(){
  refreshStatsButton.disabled = true;
  loadStatus.className = 'load-status';
  loadStatus.textContent = 'جارٍ تحميل إحصائيات المعرفة...';
  fallbackNote.hidden = true;

  try{
    const response = await fetch('assets/data/knowledge-stats.json', { cache: 'no-store' });
    if(!response.ok) throw new Error('Knowledge stats request failed');

    const stats = await response.json();
    if(!Number.isInteger(stats.qa_count) || !Number.isInteger(stats.sources_count)){
      throw new Error('Invalid knowledge stats');
    }

    qaCount.textContent = stats.qa_count.toLocaleString('ar-SA');
    sourcesCount.textContent = stats.sources_count.toLocaleString('ar-SA');
    updatedAt.textContent = formatArabicDate(stats.updated_at);
    loadStatus.className = 'load-status success';
    loadStatus.textContent = 'تم تحميل إحصائيات المعرفة بنجاح.';
  }catch(_){
    qaCount.textContent = '—';
    sourcesCount.textContent = '—';
    updatedAt.textContent = '—';
    loadStatus.className = 'load-status error';
    loadStatus.textContent = 'تعذر تحميل إحصائيات المعرفة.';
    fallbackNote.hidden = false;
  }finally{
    refreshStatsButton.disabled = false;
  }
}

document.querySelectorAll('.copy-command').forEach((button) => {
  button.addEventListener('click', async () => {
    const command = button.previousElementSibling?.textContent || '';
    const originalLabel = button.textContent;

    try{
      await navigator.clipboard.writeText(command);
      button.textContent = 'تم النسخ';
    }catch(_){
      button.textContent = 'تعذر النسخ';
    }

    window.setTimeout(() => {
      button.textContent = originalLabel;
    }, 1600);
  });
});

refreshStatsButton.addEventListener('click', loadKnowledgeStats);
loadKnowledgeStats();
