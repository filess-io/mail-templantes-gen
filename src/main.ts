#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs/promises';
import path from 'path';
import { minify as minifyHtml } from '@minify-html/node';
import * as cheerio from 'cheerio';
import { twi } from "tw-to-css";
import css from 'css';
import { getBaseCss, getLatestVersion } from "./constants";

function classesNotInTailwind(classes: string[]) {
    return classes.filter(c => !twi(c));
}

function findStyleForClass($: cheerio.CheerioAPI, className: string) {
    const styles = $('style');

    const allStylesStr = styles.map((i, el) => $(el).html()).get().join('\n');
    const allStyles = css.parse(allStylesStr);
    const style = allStyles.stylesheet!.rules.find(rule => {
        if (rule.type === 'rule' && 'selectors' in rule && rule.selectors?.includes(`.${className}`)) {
            return rule.declarations;
        }
    });

    if (style && style.type === 'rule' && 'declarations' in style) {
        return (style.declarations?.map(d => {
            if (d.type === 'declaration' && 'property' in d && 'value' in d && d.property !== '') {
                return `${d.property}: ${d.value}`;
            }
            return '';
        }) ?? []).join('; ');
    }

    return "";
}

async function processTemplate(templateName: string) {
    const template = await fs.readFile(path.join(__dirname, '..', 'templates', templateName), 'utf8');
    const $ = cheerio.load(template);

    // insert all base styles to the corresponding elements

    const baseStyleTxt = getBaseCss(getLatestVersion());
    const baseStyle = css.parse(baseStyleTxt);

    baseStyle.stylesheet!.rules.forEach(rule => {
        if (rule.type === 'rule' && 'selectors' in rule) {

            rule.selectors?.forEach(selector => {
                if (selector.includes(':')) return; // if selector is pseudo class, skip it

                const elements = $(['html', 'body'].includes(selector) ? selector : `body ${selector}`);
                elements.each((i, el) => {
                    const existingStyle = $(el).attr('style');
                    const styleStr = rule.declarations!.map(d => {
                        if (d.type === 'declaration' && 'property' in d && 'value' in d && d.property !== '') {
                            return `${d.property}: ${d.value}`;
                        }
                        return '';
                    }).join('; ').concat(';');
                    $(el).attr('style', (existingStyle ? `${existingStyle};` : '').concat(styleStr));
                });
            });

        }
    });

    const allElementsWithClasses = $('[class]');
    allElementsWithClasses.each((i, el) => {
        const classes = $(el).attr('class')!.split(' ');
        const css = twi(classes, { minify: true, merge: true });
        const existingStyle = $(el).attr('style');
        if (css) $(el).attr('style', (existingStyle ? `${existingStyle};` : '').concat(css));

        const classesNotInTW = classesNotInTailwind(classes);
        if (classesNotInTW.length > 0) {
            classesNotInTW.forEach(c => {
                const styleStr = findStyleForClass($, c);
                const existingStyle = $(el).attr('style');
                $(el).attr('style', (existingStyle ? `${existingStyle};` : '').concat(styleStr));
            });
        }

        $(el).removeAttr('class');
    });

    $('style').remove(); // delete all style tags

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
        .option('clean', {
            alias: 'c',
            describe: 'Clean output directory before processing',
            type: 'boolean',
            default: false
        })
        .argv;

    const inputPath = path.join(argv.input);
    const outputPath = path.join(argv.output);

    if (!fs.stat(inputPath)) {
        console.error(`Input directory ${inputPath} does not exist`);
        return;
    }

    const files = await fs.readdir(inputPath);
    const templatesNames = files.filter(f => f.endsWith('.html'));

    if (argv.clean) {
        await fs.rmdir(outputPath, { recursive: true });
    }
    await fs.mkdir(outputPath, { recursive: true, mode: 0o644 });

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
