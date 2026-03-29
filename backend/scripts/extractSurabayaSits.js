import {
    extractSurabayaSitsDataset,
    formatSurabayaSitsSummary,
    parseSurabayaSitsCliArgs,
    writeSurabayaSitsOutputs,
} from '../services/surabayaSitsExtractor.js';

async function main() {
    const args = parseSurabayaSitsCliArgs(process.argv.slice(2));
    const dataset = await extractSurabayaSitsDataset({
        timeoutSeconds: args.timeoutSeconds,
        probeHosts: args.probeHosts,
    });
    const outputPaths = await writeSurabayaSitsOutputs({
        privatePayload: dataset.privatePayload,
        reportPayload: dataset.reportPayload,
        privatePath: args.outPrivate,
        reportPath: args.outReport,
    });

    console.log(formatSurabayaSitsSummary(dataset.summary, outputPaths));
}

main().catch(error => {
    console.error(`Surabaya SITS extractor failed: ${error.message}`);
    process.exitCode = 1;
});
