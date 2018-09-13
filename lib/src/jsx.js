"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const babel_generator_1 = require("babel-generator");
const t = require("babel-types");
const lodash_1 = require("lodash");
const constant_1 = require("./constant");
const create_html_element_1 = require("./create-html-element");
const utils_1 = require("./utils");
function isStartWithWX(str) {
    return str[0] === 'w' && str[1] === 'x';
}
exports.isStartWithWX = isStartWithWX;
const specialComponentName = ['block', 'Block', 'slot', 'Slot'];
function removeJSXThisProperty(path) {
    if (!path.parentPath.isCallExpression()) {
        const p = path.getSibling('property');
        if (p.isIdentifier({ name: 'props' }) ||
            p.isIdentifier({ name: 'state' })) {
            path.parentPath.replaceWithSourceString('this');
        }
        else {
            path.parentPath.replaceWith(p);
        }
    }
}
exports.removeJSXThisProperty = removeJSXThisProperty;
function findJSXAttrByName(attrs, name) {
    for (const attr of attrs) {
        if (!t.isJSXIdentifier(attr.name)) {
            break;
        }
        if (attr.name.name === name) {
            return attr;
        }
    }
    return null;
}
exports.findJSXAttrByName = findJSXAttrByName;
function buildRefTemplate(name, refName, loop, key) {
    const attrs = [
        t.jSXAttribute(t.jSXIdentifier('is'), t.stringLiteral(name)),
        t.jSXAttribute(t.jSXIdentifier('data'), t.stringLiteral(`{{...${refName ? `${loop ? '' : '$$'}${refName}` : '__data'}}}`))
    ];
    if (key) {
        attrs.push(key);
    }
    return t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('template'), attrs), t.jSXClosingElement(t.jSXIdentifier('template')), []);
}
exports.buildRefTemplate = buildRefTemplate;
function buildJSXAttr(name, value) {
    return t.jSXAttribute(t.jSXIdentifier(name), t.jSXExpressionContainer(value));
}
exports.buildJSXAttr = buildJSXAttr;
function newJSXIfAttr(jsx, value) {
    jsx.openingElement.attributes.push(buildJSXAttr('wx:if', value));
}
exports.newJSXIfAttr = newJSXIfAttr;
function setJSXAttr(jsx, name, value, path) {
    const element = jsx.openingElement;
    if (!t.isJSXIdentifier(element.name)) {
        return;
    }
    if (element.name.name === 'Block' || element.name.name === 'block' || !path) {
        jsx.openingElement.attributes.push(t.jSXAttribute(t.jSXIdentifier(name), value));
    }
    else {
        const block = buildBlockElement();
        setJSXAttr(block, name, value);
        block.children = [jsx];
        path.node = block;
    }
}
exports.setJSXAttr = setJSXAttr;
function isAllLiteral(...args) {
    return args.every(p => t.isLiteral(p));
}
exports.isAllLiteral = isAllLiteral;
function buildBlockElement() {
    return t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('block'), []), t.jSXClosingElement(t.jSXIdentifier('block')), []);
}
exports.buildBlockElement = buildBlockElement;
function parseJSXChildren(children) {
    return children
        .filter(child => {
        return !(t.isJSXText(child) && child.value.trim() === '');
    })
        .reduce((str, child) => {
        if (t.isJSXText(child)) {
            return str + child.value;
        }
        if (t.isJSXElement(child)) {
            return str + parseJSXElement(child);
        }
        if (t.isJSXExpressionContainer(child)) {
            if (t.isJSXElement(child.expression)) {
                return str + parseJSXElement(child.expression);
            }
            return str + `{${babel_generator_1.default(child)
                .code
                .replace(/(this\.props\.)|(this\.state\.)/g, '')
                .replace(/(props\.)|(state\.)/g, '')
                .replace(/this\./, '')}}`;
        }
        return str;
    }, '');
}
function parseJSXElement(element) {
    const children = element.children;
    const { attributes, name } = element.openingElement;
    if (t.isJSXMemberExpression(name)) {
        throw utils_1.codeFrameError(name.loc, '暂不支持 JSX 成员表达式');
    }
    const componentName = name.name;
    const isDefaultComponent = constant_1.DEFAULT_Component_SET.has(componentName);
    const componentSpecialProps = constant_1.SPECIAL_COMPONENT_PROPS.get(componentName);
    let attributesTrans = {};
    if (attributes.length) {
        attributesTrans = attributes.reduce((obj, attr) => {
            if (t.isJSXSpreadAttribute(attr)) {
                throw utils_1.codeFrameError(attr.loc, 'JSX 参数暂不支持 ...spread 表达式');
            }
            let name = attr.name.name;
            if (constant_1.DEFAULT_Component_SET.has(componentName)) {
                if (name === 'className') {
                    name = 'class';
                }
            }
            let value = true;
            let attrValue = attr.value;
            if (typeof name === 'string') {
                if (t.isStringLiteral(attrValue)) {
                    value = attrValue.value;
                }
                else if (t.isJSXExpressionContainer(attrValue)) {
                    const isBindEvent = (name.startsWith('bind') && name !== 'bind') || (name.startsWith('catch') && name !== 'catch');
                    let { code } = babel_generator_1.default(attrValue.expression);
                    code = code
                        .replace(/(this\.props\.)|(this\.state\.)/g, '')
                        .replace(/this\./g, '');
                    value = isBindEvent ? code : `{{${code}}}`;
                    if (t.isStringLiteral(attrValue.expression)) {
                        value = attrValue.expression.value;
                    }
                }
                else if (attrValue === null && name !== 'wx:else') {
                    value = `{{true}}`;
                }
                if (componentSpecialProps &&
                    componentSpecialProps.has(name) ||
                    name.startsWith('__fn_')) {
                    obj[name] = value;
                }
                else {
                    obj[isDefaultComponent && !name.includes('-') && !name.includes(':') ? lodash_1.kebabCase(name) : name] = value;
                }
            }
            if (!isDefaultComponent && !specialComponentName.includes(componentName)) {
                obj['__triggerObserer'] = '{{ _triggerObserer }}';
            }
            return obj;
        }, {});
    }
    else if (!isDefaultComponent && !specialComponentName.includes(componentName)) {
        attributesTrans['__triggerObserer'] = '{{ _triggerObserer }}';
    }
    return create_html_element_1.createHTMLElement({
        name: lodash_1.kebabCase(componentName),
        attributes: attributesTrans,
        value: parseJSXChildren(children)
    });
}
exports.parseJSXElement = parseJSXElement;
function generateHTMLTemplate(template, name) {
    return create_html_element_1.createHTMLElement({
        name: 'template',
        attributes: {
            name
        },
        value: parseJSXElement(template)
    });
}
exports.generateHTMLTemplate = generateHTMLTemplate;
//# sourceMappingURL=jsx.js.map