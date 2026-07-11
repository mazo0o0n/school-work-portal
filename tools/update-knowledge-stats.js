const fs = require('fs/promises');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const primaryKnowledgeFile = path.join(projectRoot, 'knowledge.md');
const approvedKnowledgeDirectory = path.join(projectRoot, 'knowledge-files', 'approved');
const outputFile = path.join(projectRoot, 'assets', 'data', 'knowledge-stats.json');

function countLevelThreeHeadings(content){
  return (content.match(/^###(?:[ \t]+|$)/gm) || []).length;
}

async function main(){
  const approvedEntries = await fs.readdir(approvedKnowledgeDirectory, { withFileTypes: true });
  const approvedFiles = approvedEntries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
    .map((entry) => path.join(approvedKnowledgeDirectory, entry.name))
    .sort();

  const sourceFiles = [primaryKnowledgeFile, ...approvedFiles];
  const contents = await Promise.all(sourceFiles.map((file) => fs.readFile(file, 'utf8')));
  const stats = {
    qa_count: contents.reduce((total, content) => total + countLevelThreeHeadings(content), 0),
    sources_count: sourceFiles.length,
    updated_at: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  console.log(`Updated knowledge stats: ${stats.qa_count} Q&A items from ${stats.sources_count} sources.`);
}

main().catch((error) => {
  console.error('Failed to update knowledge stats:', error.message);
  process.exitCode = 1;
});
