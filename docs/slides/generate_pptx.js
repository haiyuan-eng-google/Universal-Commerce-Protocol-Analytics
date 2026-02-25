const pptxgen = require('pptxgenjs');
const html2pptx = require('/Users/haiyuancao/.claude/plugins/cache/anthropic-agent-skills/document-skills/69c0b1a06741/skills/pptx/scripts/html2pptx');
const path = require('path');

async function createPresentation() {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9';
    pptx.author = 'UCP Analytics Team';
    pptx.title = 'UCP Analytics — Whiteboard Session';

    const slidesDir = '/Users/haiyuancao/Universal-Commerce-Protocol-Analytics/docs/slides';

    const slideFiles = [
        'slide01_title.html',
        'slide02_what_is_ucp.html',
        'slide03_the_gap.html',
        'slide04_our_solution.html',
        'slide05_architecture.html',
        'slide06_event_types.html',
        'slide07_design_decisions.html',
        'slide08_business_value.html',
        'slide09_current_state.html',
        'slide10_discussion.html',
    ];

    for (const file of slideFiles) {
        const filePath = path.join(slidesDir, file);
        console.log(`Processing: ${file}`);
        try {
            await html2pptx(filePath, pptx);
            console.log(`  ✓ ${file} done`);
        } catch (err) {
            console.error(`  ✗ ${file} failed: ${err.message}`);
            throw err;
        }
    }

    const outputPath = '/Users/haiyuancao/Universal-Commerce-Protocol-Analytics/docs/ucp_analytics_whiteboard.pptx';
    await pptx.writeFile({ fileName: outputPath });
    console.log(`\nPresentation saved to: ${outputPath}`);
}

createPresentation().catch(err => {
    console.error('Failed to create presentation:', err);
    process.exit(1);
});
