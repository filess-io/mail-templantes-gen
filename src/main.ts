#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs/promises';
import path from 'path';
import { minify as minifyHtml } from '@minify-html/node';
import * as cheerio from 'cheerio';
import { twi } from "tw-to-css";
import { getBaseCss, getLatestVersion } from "./constants";

function classesNotInTailwind(classes: string[]) {
    return classes.filter(c => !twi(c));
}

async function processTemplate(templateName: string) {
    const template = await fs.readFile(path.join(__dirname, '..', 'templates', templateName), 'utf8');
    const $ = cheerio.load(template);

    // create a style tag with the tailwind classes
    const style = $(`<style>${getBaseCss(getLatestVersion())}</style>`);
    $('head').append(style);

    const allElementsWithClasses = $('[class]');
    allElementsWithClasses.each((i, el) => {
        const classes = $(el).attr('class')!.split(' ');
        const css = twi(classes, { minify: true, merge: true });
        const existingStyle = $(el).attr('style');
        if (css) $(el).attr('style', (existingStyle ? `${existingStyle};` : '').concat(css));

        // detect the classes that are not in tailwind
        const classesNotInTW = classesNotInTailwind(classes);
        if (classesNotInTW.length > 0) {
            $(el).attr('class', classesNotInTW.join(' '));
        } else {
            $(el).removeAttr('class');
        }
    });

    return $.html();
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('input', {
            alias: 'i',
            describe: 'Input directory for HTML templates',
            type: 'string',
            demandOption: true
        })
        .option('output', {
            alias: 'o',
            describe: 'Output directory for processed HTML',
            type: 'string',
            demandOption: true
        })
        .option('mode', {
            alias: 'm',
            describe: 'Output mode (e.g., minified)',
            type: 'string',
            default: 'minified'
        })
        .argv;

    const inputPath = path.join(argv.input);
    const outputPath = path.join(argv.output);

    const files = await fs.readdir(inputPath);
    const templatesNames = files.filter(f => f.endsWith('.html'));

    for (const templateName of templatesNames) {
        const processed = await processTemplate(templateName);
        let outputData;
        switch (argv.mode) {
            case 'minified':
                outputData = minifyHtml(Buffer.from(processed), { minify_css: true, do_not_minify_doctype: true });
                break;

            default:
                outputData = processed;
        }
        await fs.writeFile(path.join(outputPath, templateName), outputData);
    }
}

main().catch(console.error);
