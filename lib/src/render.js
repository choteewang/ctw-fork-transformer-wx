"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const t = require("babel-types");
const utils_1 = require("./utils");
const lodash_1 = require("lodash");
const jsx_1 = require("./jsx");
const constant_1 = require("./constant");
const babel_generator_1 = require("babel-generator");
const template = require('babel-template');
const calleeId = utils_1.incrementId();
function isClassDcl(p) {
    return p.isClassExpression() || p.isClassDeclaration();
}
function isChildrenOfJSXAttr(p) {
    return !!p.findParent(p => p.isJSXAttribute());
}
function isContainStopPropagation(path) {
    let matched = false;
    if (path) {
        path.traverse({
            Identifier(p) {
                if (p.node.name === 'stopPropagation' &&
                    p.parentPath.parentPath.isCallExpression()) {
                    matched = true;
                }
            }
        });
    }
    return matched;
}
function buildAssignState(pendingState) {
    return t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('assign')), [
        t.memberExpression(t.thisExpression(), t.identifier('state')),
        pendingState
    ]));
}
class RenderParser {
    constructor(renderPath, methods, initState, referencedIdentifiers, usedState, loopStateName, customComponentNames, customComponentData, componentProperies) {
        this.classProperties = new Set();
        this.templates = new Map();
        this.jsxDeclarations = new Set();
        this.loopScopes = new Set();
        this.returnedPaths = [];
        this.usedThisState = new Set();
        this.loopComponents = new Map();
        this.loopRefIdentifiers = new Map();
        this.reserveStateWords = new Set(['state', 'props']);
        this.topLevelIfStatement = new Set();
        this.usedEvents = new Set();
        this.handleJSXElement = (jsxElementPath, func) => {
            const parentNode = jsxElementPath.parent;
            const parentPath = jsxElementPath.parentPath;
            const isJSXChildren = t.isJSXElement(parentNode);
            if (!isJSXChildren) {
                let statementParent = jsxElementPath.getStatementParent();
                const isReturnStatement = statementParent.isReturnStatement();
                const isFinalReturn = statementParent.getFunctionParent().isClassMethod();
                if (!(statementParent.isVariableDeclaration() ||
                    statementParent.isExpressionStatement())) {
                    statementParent = statementParent.findParent(s => s.isVariableDeclaration() || s.isExpressionStatement());
                }
                if (t.isVariableDeclarator(parentNode)) {
                    if (statementParent) {
                        const name = utils_1.findIdentifierFromStatement(statementParent.node);
                        // setTemplate(name, path, templates)
                        name && this.templates.set(name, jsxElementPath.node);
                    }
                }
                func({ parentNode, parentPath, statementParent, isReturnStatement, isFinalReturn });
            }
        };
        this.loopComponentVisitor = {
            VariableDeclarator(path) {
                const id = path.get('id');
                const init = path.get('init');
                const parentPath = path.parentPath;
                if (id.isObjectPattern() &&
                    init.isThisExpression() &&
                    parentPath.isVariableDeclaration()) {
                    const { properties } = id.node;
                    const declareState = template('const state = this.state;')();
                    if (properties.length > 1) {
                        const index = properties.findIndex(p => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'state' }));
                        properties.splice(index, 1);
                        parentPath.insertAfter(declareState);
                    }
                    else {
                        parentPath.insertAfter(declareState);
                        parentPath.remove();
                    }
                }
            },
            JSXElement: {
                enter: (jsxElementPath) => {
                    this.handleJSXElement(jsxElementPath, (options) => {
                        this.handleConditionExpr(options, jsxElementPath);
                    });
                },
                exit: (jsxElementPath) => {
                    this.handleJSXElement(jsxElementPath, ({ parentNode, parentPath, statementParent, isFinalReturn }) => {
                        if (statementParent && statementParent.findParent(p => p === this.renderPath)) {
                            this.jsxDeclarations.add(statementParent);
                        }
                        if (t.isReturnStatement(parentNode)) {
                            if (!isFinalReturn) {
                                const callExpr = parentPath.findParent(p => p.isCallExpression());
                                if (callExpr.isCallExpression()) {
                                    const callee = callExpr.node.callee;
                                    if (this.loopComponents.has(callExpr)) {
                                        return;
                                    }
                                    if (t.isMemberExpression(callee) &&
                                        t.isIdentifier(callee.property) &&
                                        callee.property.name === 'map') {
                                        let ary = callee.object;
                                        if (t.isCallExpression(ary) || utils_1.isContainFunction(callExpr.get('callee').get('object'))) {
                                            const variableName = `${constant_1.LOOP_CALLEE}_${calleeId()}`;
                                            callExpr.getStatementParent().insertBefore(utils_1.buildConstVariableDeclaration(variableName, ary));
                                            ary = t.identifier(variableName);
                                        }
                                        if (t.isMemberExpression(ary)) {
                                            const id = utils_1.findFirstIdentifierFromMemberExpression(ary);
                                            if (t.isIdentifier(id)) {
                                                this.referencedIdentifiers.add(id);
                                            }
                                        }
                                        else if (t.isIdentifier(ary)) {
                                            const parentCallExpr = callExpr.find(p => p.isCallExpression());
                                            if (!utils_1.isArrayMapCallExpression(parentCallExpr) && parentCallExpr !== callExpr) {
                                                this.referencedIdentifiers.add(ary);
                                            }
                                        }
                                        jsx_1.setJSXAttr(jsxElementPath.node, 'wx:for', t.jSXExpressionContainer(ary));
                                        const [func] = callExpr.node.arguments;
                                        if (t.isFunctionExpression(func) ||
                                            t.isArrowFunctionExpression(func)) {
                                            const [item, index] = func.params;
                                            if (t.isIdentifier(item)) {
                                                jsx_1.setJSXAttr(jsxElementPath.node, 'wx:for-item', t.stringLiteral(item.name));
                                                this.loopScopes.add(item.name);
                                            }
                                            else if (t.isObjectPattern(item)) {
                                                throw utils_1.codeFrameError(item.loc, 'JSX map 循环参数暂时不支持使用 Object pattern 解构。');
                                            }
                                            else {
                                                jsx_1.setJSXAttr(jsxElementPath.node, 'wx:for-item', t.stringLiteral('__item'));
                                            }
                                            if (t.isIdentifier(index)) {
                                                jsx_1.setJSXAttr(jsxElementPath.node, 'wx:for-index', t.stringLiteral(index.name));
                                                this.loopScopes.add(index.name);
                                            }
                                            this.loopComponents.set(callExpr, jsxElementPath);
                                            // caller.replaceWith(jsxElementPath.node)
                                            if (statementParent) {
                                                const name = utils_1.findIdentifierFromStatement(statementParent.node);
                                                // setTemplate(name, path, templates)
                                                name && this.templates.set(name, jsxElementPath.node);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        else if (t.isArrowFunctionExpression(parentNode)) {
                            parentPath.replaceWith(t.arrowFunctionExpression(parentNode.params, t.blockStatement([
                                t.returnStatement(jsxElementPath.node)
                            ])));
                        }
                    });
                }
            }
        };
        this.jsxElementVisitor = {
            JSXElement: (jsxElementPath) => {
                this.handleJSXElement(jsxElementPath, (options) => {
                    const { parentNode, parentPath, isFinalReturn } = options;
                    this.handleConditionExpr(options, jsxElementPath);
                    // this.jsxDeclarations.add(statementParent)
                    /**
                     * @TODO
                     * 有空做一个 TS 的 pattern matching 函数
                     * 把分支重构出来复用
                     */
                    if (t.isReturnStatement(parentNode)) {
                        if (!isFinalReturn) {
                            //
                        }
                        else {
                            const ifStatement = parentPath.findParent(p => p.isIfStatement());
                            const blockStatement = parentPath.findParent(p => p.isBlockStatement() && p.parentPath === ifStatement);
                            if (blockStatement && blockStatement.isBlockStatement()) {
                                blockStatement.traverse({
                                    VariableDeclarator: (p) => {
                                        const { id, init } = p.node;
                                        if (t.isIdentifier(id)) {
                                            const newId = this.renderScope.generateDeclaredUidIdentifier('$' + id.name);
                                            blockStatement.scope.rename(id.name, newId.name);
                                            p.parentPath.replaceWith(template('ID = INIT;')({ ID: newId, INIT: init }));
                                        }
                                    }
                                });
                            }
                            const block = this.finalReturnElement || jsx_1.buildBlockElement();
                            if (utils_1.isBlockIfStatement(ifStatement, blockStatement)) {
                                const { test, alternate, consequent } = ifStatement.node;
                                // blockStatement.node.body.push(t.returnStatement(
                                //   t.memberExpression(t.thisExpression(), t.identifier('state'))
                                // ))
                                if (alternate === blockStatement.node) {
                                    throw utils_1.codeFrameError(parentNode.loc, '不必要的 else 分支，请遵从 ESLint consistent-return: https://eslint.org/docs/rules/consistent-return');
                                }
                                else if (consequent === blockStatement.node) {
                                    const parentIfStatement = ifStatement.findParent(p => p.isIfStatement());
                                    if (parentIfStatement) {
                                        jsx_1.setJSXAttr(jsxElementPath.node, 'wx:elif', t.jSXExpressionContainer(test), jsxElementPath);
                                    }
                                    else {
                                        if (this.topLevelIfStatement.size > 0) {
                                            jsx_1.setJSXAttr(jsxElementPath.node, 'wx:elif', t.jSXExpressionContainer(test), jsxElementPath);
                                        }
                                        else {
                                            utils_1.newJSXIfAttr(jsxElementPath.node, test, jsxElementPath);
                                            this.topLevelIfStatement.add(ifStatement);
                                        }
                                    }
                                }
                            }
                            else if (block.children.length !== 0) {
                                jsx_1.setJSXAttr(jsxElementPath.node, 'wx:else');
                            }
                            block.children.push(jsxElementPath.node);
                            this.finalReturnElement = block;
                            this.returnedPaths.push(parentPath);
                        }
                    }
                    else if (t.isArrowFunctionExpression(parentNode)) {
                        // console.log('arrow')
                    }
                    else if (t.isAssignmentExpression(parentNode)) {
                        if (t.isIdentifier(parentNode.left)) {
                            const name = parentNode.left.name;
                            const bindingNode = this.renderScope.getOwnBinding(name).path.node;
                            const block = this.templates.get(name) || jsx_1.buildBlockElement();
                            if (utils_1.isEmptyDeclarator(bindingNode)) {
                                const ifStatement = parentPath.findParent(p => p.isIfStatement());
                                const blockStatement = parentPath.findParent(p => p.isBlockStatement());
                                if (utils_1.isBlockIfStatement(ifStatement, blockStatement)) {
                                    const { test, alternate, consequent } = ifStatement.node;
                                    if (alternate === blockStatement.node) {
                                        jsx_1.setJSXAttr(jsxElementPath.node, 'wx:else');
                                    }
                                    else if (consequent === blockStatement.node) {
                                        const parentIfStatement = ifStatement.findParent(p => p.isIfStatement());
                                        if (parentIfStatement && parentIfStatement.get('alternate') === ifStatement) {
                                            jsx_1.setJSXAttr(jsxElementPath.node, 'wx:elif', t.jSXExpressionContainer(test), jsxElementPath);
                                        }
                                        else {
                                            if (parentIfStatement) {
                                                utils_1.newJSXIfAttr(block, parentIfStatement.node.test, jsxElementPath);
                                            }
                                            utils_1.newJSXIfAttr(jsxElementPath.node, test, jsxElementPath);
                                        }
                                    }
                                    block.children.push(jsxElementPath.node);
                                    // setTemplate(name, path, templates)
                                    name && this.templates.set(name, block);
                                }
                            }
                            else {
                                throw utils_1.codeFrameError(jsxElementPath.node.loc, '请将 JSX 赋值表达式初始化为 null，然后再进行 if 条件表达式赋值。');
                            }
                        }
                    }
                    else if (!t.isJSXElement(parentNode)) {
                        // throwError(path, '考虑只对 JSX 元素赋值一次。')
                    }
                });
                // handle jsx attrs
                jsxElementPath.traverse(this.jsxAttrVisitor);
            }
        };
        this.jsxAttrVisitor = {
            JSXExpressionContainer: (path) => {
                if (!isChildrenOfJSXAttr(path)) {
                    return;
                }
                const expression = path.get('expression');
                if (expression.isStringLiteral()) {
                    path.replaceWith(expression);
                }
                else if (expression.isCallExpression()) {
                    const node = expression.node;
                    if (t.isMemberExpression(node.callee) &&
                        t.isIdentifier(node.callee.property) &&
                        node.callee.property.name === 'bind') {
                        const JSXElement = path.findParent(p => p.isJSXElement())
                            .node;
                        // const JSXAttribute = path.findParent(p => p.isJSXAttribute())
                        let bindCalleeName = null;
                        if (t.isIdentifier(node.callee.object)) {
                            bindCalleeName = node.callee.object.name;
                        }
                        else if (t.isMemberExpression(node.callee.object)) {
                            if (t.isIdentifier(node.callee.object.property)) {
                                bindCalleeName = node.callee.object.property.name;
                            }
                        }
                        if (bindCalleeName !== null) {
                            const args = expression.get('arguments');
                            args.forEach((arg, index) => {
                                const node = arg.node;
                                const argName = babel_generator_1.default(node).code;
                                if (index === 0) {
                                    jsx_1.setJSXAttr(JSXElement, `data-e-${bindCalleeName}-so`, t.stringLiteral(argName));
                                }
                                else {
                                    let expr = null;
                                    if (t.isIdentifier(node) && path.scope.hasBinding(argName)) {
                                        this.addRefIdentifier(path, node);
                                        expr = t.jSXExpressionContainer(node);
                                    }
                                    else if (node.type === 'NumericLiteral' || t.isStringLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) {
                                        expr = t.jSXExpressionContainer(node);
                                    }
                                    else if (utils_1.hasComplexExpression(arg)) {
                                        const id = utils_1.generateAnonymousState(this.renderScope, arg, this.referencedIdentifiers);
                                        expr = t.jSXExpressionContainer(id);
                                    }
                                    else {
                                        expr = t.jSXExpressionContainer(t.identifier(argName));
                                    }
                                    jsx_1.setJSXAttr(JSXElement, `data-e-${bindCalleeName}-a-${utils_1.toLetters(index)}`, expr);
                                }
                            });
                            expression.replaceWith(t.stringLiteral(`${bindCalleeName}`));
                        }
                    }
                }
            },
            JSXAttribute: (path) => {
                const { name, value } = path.node;
                let eventShouldBeCatched = false;
                const jsxElementPath = path.parentPath.parentPath;
                if (t.isJSXIdentifier(name) && jsxElementPath.isJSXElement()) {
                    const componentName = jsxElementPath.node.openingElement.name.name;
                    if (name.name === 'key') {
                        if (constant_1.THIRD_PARTY_COMPONENTS.has(componentName)) {
                            return;
                        }
                        const jsx = path.findParent(p => p.isJSXElement());
                        const loopBlock = jsx.findParent(p => {
                            if (p.isJSXElement()) {
                                const element = p.get('openingElement');
                                if (element.get('name').isJSXIdentifier({ name: 'block' })) {
                                    const attrs = element.node.attributes;
                                    const hasWXForLoop = attrs.some(attr => t.isJSXIdentifier(attr.name, { name: 'wx:for' }));
                                    const hasWXKey = attrs.some(attr => t.isJSXIdentifier(attr.name, { name: 'wx:key' }));
                                    return hasWXForLoop && !hasWXKey;
                                }
                            }
                            return false;
                        });
                        if (loopBlock) {
                            jsx_1.setJSXAttr(loopBlock.node, 'wx:key', value);
                            path.remove();
                        }
                        else {
                            path.get('name').replaceWith(t.jSXIdentifier('wx:key'));
                        }
                    }
                    else if (name.name.startsWith('on')) {
                        if (t.isJSXExpressionContainer(value)) {
                            const methodName = utils_1.findMethodName(value.expression);
                            methodName && this.usedEvents.add(methodName);
                            if (this.methods.has(methodName)) {
                                const method = this.methods.get(methodName);
                                // if (method && t.isIdentifier(method.node.key)) {
                                //   this.usedEvents.add(methodName)
                                // } else if (method === null) {
                                //   this.usedEvents.add(methodName)
                                // }
                                if (!babel_generator_1.default(value.expression).code.includes('.bind')) {
                                    path.node.value = t.stringLiteral(`${methodName}`);
                                }
                                eventShouldBeCatched = isContainStopPropagation(method);
                                const componentName = jsxElementPath.node.openingElement.name;
                                if (t.isJSXIdentifier(componentName) && !constant_1.DEFAULT_Component_SET.has(componentName.name)) {
                                    const element = path.parent;
                                    if (process.env.NODE_ENV !== 'test') {
                                        const fnName = `__fn_${name.name}`;
                                        element.attributes = element.attributes.concat([t.jSXAttribute(t.jSXIdentifier(fnName))]);
                                    }
                                }
                            }
                        }
                        if (t.isJSXIdentifier(jsxElementPath.node.openingElement.name)) {
                            const componentName = jsxElementPath.node.openingElement.name.name;
                            if (constant_1.DEFAULT_Component_SET.has(componentName)) {
                                let transformName = `${eventShouldBeCatched ? 'catch' : 'bind'}`
                                    + name.name.slice(2).toLowerCase();
                                if (name.name === 'onClick') {
                                    transformName = eventShouldBeCatched ? 'catchtap' : 'bindtap';
                                }
                                path.node.name = t.jSXIdentifier(transformName);
                            }
                            else if (constant_1.THIRD_PARTY_COMPONENTS.has(componentName)) {
                                path.node.name = t.jSXIdentifier('bind' + name.name.slice(2));
                            }
                            else {
                                path.node.name = t.jSXIdentifier('bind' + name.name.toLowerCase());
                            }
                        }
                        // let transformName = `${eventShouldBeCatched ? 'catch' : 'bind'}` + name.name.slice(2, name.name.length)
                        // transformName = eventShouldBeCatched
                        //   ? CATCH_EVENT_MAP.get(name.name)!
                        //   : BIND_EVENT_MAP.get(name.name)!
                    }
                }
            },
            Identifier: (path) => {
                if (!isChildrenOfJSXAttr(path)) {
                    return;
                }
                if (!path.isReferencedIdentifier()) {
                    return;
                }
                const parentPath = path.parentPath;
                if (parentPath.isConditionalExpression() ||
                    parentPath.isLogicalExpression() ||
                    parentPath.isJSXExpressionContainer() ||
                    this.renderScope.hasOwnBinding(path.node.name)) {
                    this.addRefIdentifier(path, path.node);
                }
            },
            MemberExpression: (path) => {
                if (!isChildrenOfJSXAttr(path)) {
                    return;
                }
                if (!path.isReferencedMemberExpression() || path.parentPath.isMemberExpression()) {
                    return;
                }
                const { object, property } = path.node;
                if (t.isMemberExpression(object) &&
                    t.isThisExpression(object.object) &&
                    t.isIdentifier(object.property, { name: 'state' })) {
                    if (t.isIdentifier(property)) {
                        this.usedThisState.add(property.name);
                    }
                    else if (t.isMemberExpression(property)) {
                        const id = utils_1.findFirstIdentifierFromMemberExpression(property);
                        if (id && this.renderScope.hasBinding(id.name)) {
                            this.usedThisState.add(id.name);
                        }
                    }
                    return;
                }
                const code = babel_generator_1.default(path.node).code;
                if (code.includes('this.$router.params') && t.isIdentifier(property)) {
                    const name = this.renderScope.generateUid(property.name);
                    const dcl = utils_1.buildConstVariableDeclaration(name, path.node);
                    this.renderPath.node.body.body.unshift(dcl);
                    path.replaceWith(t.identifier(name));
                }
                const parentPath = path.parentPath;
                const id = utils_1.findFirstIdentifierFromMemberExpression(path.node);
                if (t.isThisExpression(id)) {
                    return;
                }
                if (parentPath.isConditionalExpression() ||
                    parentPath.isLogicalExpression() ||
                    parentPath.isJSXExpressionContainer() ||
                    (this.renderScope.hasOwnBinding(id.name))) {
                    this.addRefIdentifier(path, id);
                }
            },
            ArrowFunctionExpression: (path) => {
                if (!isChildrenOfJSXAttr(path)) {
                    return;
                }
                const uid = path.scope.generateUid('_anonymous_function_');
                const c = t.classProperty(t.identifier(uid), path.node);
                this.classProperties.add(c);
            }
        };
        this.visitors = Object.assign({ JSXEmptyExpression(path) {
                const parent = path.parentPath;
                if (path.parentPath.isJSXExpressionContainer()) {
                    parent.remove();
                }
            } }, this.jsxElementVisitor, { JSXExpressionContainer: (path) => {
                // todo
                if (!t.isJSXAttribute(path.parent)) {
                    path.traverse({
                        Identifier: (path) => {
                            const parentPath = path.parentPath;
                            if (parentPath.isConditionalExpression() ||
                                parentPath.isLogicalExpression() ||
                                path.isReferencedIdentifier()) {
                                const name = path.node.name;
                                if (Object.keys(this.renderScope.getAllBindings()).includes(name)) {
                                    this.addRefIdentifier(path, path.node);
                                    // referencedIdentifiers.add(path.node)
                                }
                                if (this.templates.has(name)) {
                                    path.replaceWith(this.templates.get(name));
                                }
                            }
                        }
                    });
                }
            } });
        /**
         * jsxDeclarations,
         * renderScope,
         * methods,
         * loopScopes,
         * initState,
         * templates
         */
        this.handleLoopComponents = () => {
            const loopArrayId = utils_1.incrementId();
            const replaceQueue = [];
            this.loopComponents.forEach((component, callee) => {
                for (const dcl of this.jsxDeclarations) {
                    const isChildren = dcl && dcl.findParent(d => d === callee);
                    if (isChildren) {
                        this.jsxDeclarations.delete(dcl);
                        dcl.remove();
                    }
                }
                const blockStatementPath = component.findParent(p => p.isBlockStatement());
                const body = blockStatementPath.node.body;
                let hasOriginalRef = false;
                let stateToBeAssign = new Set(lodash_1.difference(Object.keys(blockStatementPath.scope.getAllBindings()), Object.keys(this.renderScope.getAllBindings())).filter(i => {
                    return !this.methods.has(i);
                })
                    .filter(i => !this.loopScopes.has(i))
                    .filter(i => !this.initState.has(i))
                    .filter(i => !this.templates.has(i))
                    .filter(i => !i.includes('.'))
                    .filter(i => i !== constant_1.MAP_CALL_ITERATOR));
                if (body.length > 1) {
                    const [func] = callee.node.arguments;
                    if (t.isFunctionExpression(func) || t.isArrowFunctionExpression(func)) {
                        const [item] = func.params;
                        for (const [index, statement] of body.entries()) {
                            if (t.isVariableDeclaration(statement)) {
                                for (const dcl of statement.declarations) {
                                    if (t.isIdentifier(dcl.id)) {
                                        const name = dcl.id.name;
                                        if (name.startsWith(constant_1.LOOP_STATE) || name.startsWith(constant_1.LOOP_CALLEE)) {
                                            stateToBeAssign.add(name);
                                            dcl.id = t.identifier(name);
                                        }
                                    }
                                }
                            }
                            if (t.isReturnStatement(statement)) {
                                body.splice(index, 1);
                            }
                        }
                        stateToBeAssign.forEach(s => this.loopRefIdentifiers.set(s, callee));
                        const properties = Array.from(stateToBeAssign).map(state => t.objectProperty(t.identifier(state), t.identifier(state)));
                        component.traverse({
                            Identifier(path) {
                                const name = path.node.name;
                                if (stateToBeAssign.has(name) && path.isReferencedIdentifier()) {
                                    path.replaceWith(t.memberExpression(t.identifier(item.name), path.node));
                                }
                                if (path.parentPath.isJSXExpressionContainer() &&
                                    path.isReferencedIdentifier() &&
                                    name === item.name) {
                                    path.replaceWith(t.memberExpression(t.identifier(item.name), t.identifier('$$original')));
                                    hasOriginalRef = true;
                                }
                            },
                            MemberExpression(path) {
                                const id = utils_1.findFirstIdentifierFromMemberExpression(path.node);
                                if (stateToBeAssign.has(id.name)) {
                                    path.node.object = t.identifier(item.name + '.' + id.name);
                                }
                            }
                        });
                        if (hasOriginalRef) {
                            properties.push(t.objectProperty(t.identifier('$$original'), t.identifier(item.name)));
                        }
                        const returnStatement = t.returnStatement(t.objectExpression([t.spreadProperty(t.identifier(item.name)), ...properties]));
                        const parentCallee = callee.findParent(c => utils_1.isArrayMapCallExpression(c));
                        if (utils_1.isArrayMapCallExpression(parentCallee)) {
                            const [func] = parentCallee.node.arguments;
                            const { object } = callee.node.callee;
                            if (t.isFunctionExpression(func) || t.isArrowFunctionExpression(func)) {
                                const funcBody = func.body;
                                if (t.isBlockStatement(funcBody)) {
                                    if (t.isIdentifier(object) || t.isMemberExpression(object)) {
                                        funcBody.body.splice(funcBody.body.length - 1, 0, t.expressionStatement(t.assignmentExpression('=', object, callee.node)));
                                    }
                                    else {
                                        throw utils_1.codeFrameError(object.loc, '请简化该表达式为标识符或成员表达式');
                                    }
                                }
                            }
                            body.push(returnStatement);
                        }
                        else {
                            body.push(returnStatement);
                            const stateName = 'loopArray' + loopArrayId();
                            this.loopStateName.forEach((newName, callExpr) => {
                                if (callExpr === callee) {
                                    const classBody = this.renderPath.parent;
                                    for (const property of classBody.body) {
                                        if (t.isClassProperty(property) && property.key.name === '$dynamicComponents') {
                                            const objects = property.value;
                                            for (const objProp of objects.properties) {
                                                if (t.isObjectProperty(objProp) && t.isIdentifier(objProp.key, { name: newName })) {
                                                    const func = objProp.value;
                                                    func.body.body[0] = utils_1.buildConstVariableDeclaration('stateName', t.stringLiteral(stateName));
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                            // setJSXAttr(returned, 'wx:for', t.identifier(stateName))
                            this.addRefIdentifier(callee, t.identifier(stateName));
                            // this.referencedIdentifiers.add(t.identifier(stateName))
                            jsx_1.setJSXAttr(component.node, 'wx:for', t.jSXExpressionContainer(t.identifier(stateName)));
                            this.renderPath.node.body.body.push(utils_1.buildConstVariableDeclaration(stateName, callee.node));
                        }
                        // console.log(callee.getSource())
                    }
                }
                replaceQueue.push(() => {
                    const statement = component.getStatementParent();
                    callee.replaceWith(statement.isReturnStatement()
                        ? statement.get('argument').node
                        : component.node);
                });
            });
            replaceQueue.forEach(func => func());
        };
        this.setReserveWord = (word) => {
            const binding = this.renderScope.getOwnBinding(word);
            let hasStateId = false;
            if (binding) {
                const path = binding.path;
                const id = path.get('id');
                const init = path.get('init');
                if (init.isThisExpression()) {
                    return hasStateId;
                }
                if (id.isObjectPattern()) {
                    hasStateId = id.node.properties.some(p => {
                        return (t.isObjectProperty(p) && t.isIdentifier(p.key, { name: word }))
                            || (t.isRestProperty(p) && t.isIdentifier(p.argument, { name: word }));
                    });
                }
                else if (id.isIdentifier({ name: word })) {
                    hasStateId = true;
                }
                if (hasStateId) {
                    this.referencedIdentifiers.add(t.identifier(word));
                }
            }
            if (hasStateId) {
                this.reserveStateWords.delete(word);
            }
        };
        this.renderPath = renderPath;
        this.methods = methods;
        this.initState = initState;
        this.referencedIdentifiers = referencedIdentifiers;
        this.loopStateName = loopStateName;
        this.usedState = usedState;
        this.customComponentNames = customComponentNames;
        this.customComponentData = customComponentData;
        this.componentProperies = componentProperies;
        const renderBody = renderPath.get('body');
        this.renderScope = renderBody.scope;
        const [, error] = renderPath.node.body.body.filter(s => t.isReturnStatement(s));
        if (error) {
            throw utils_1.codeFrameError(error.loc, 'render 函数顶级作用域暂时只支持一个 return');
        }
        renderBody.traverse(this.loopComponentVisitor);
        this.handleLoopComponents();
        renderBody.traverse(this.visitors);
        this.setOutputTemplate();
        this.removeJSXStatement();
        this.setUsedState();
        this.setPendingState();
        this.setCustomEvent();
        this.createData();
        this.setProperies();
    }
    handleConditionExpr({ parentNode, parentPath, statementParent }, jsxElementPath) {
        if (t.isLogicalExpression(parentNode)) {
            const { left, operator, right } = parentNode;
            const leftExpression = parentPath.get('left');
            if (operator === '&&' && t.isExpression(left)) {
                if (utils_1.hasComplexExpression(leftExpression)) {
                    utils_1.generateAnonymousState(this.renderScope, leftExpression, this.referencedIdentifiers, true);
                }
                const block = jsx_1.buildBlockElement();
                utils_1.newJSXIfAttr(block, leftExpression.node);
                block.children = [jsxElementPath.node];
                parentPath.replaceWith(block);
                if (statementParent) {
                    const name = utils_1.findIdentifierFromStatement(statementParent.node);
                    utils_1.setTemplate(name, jsxElementPath, this.templates);
                    // name && templates.set(name, path.node)
                }
            }
            if (operator === '||' && t.isExpression(left)) {
                const newNode = t.conditionalExpression(left, left, right);
                parentPath.replaceWith(newNode);
                // this.handleConditionExpr({ parentNode: newNode, parentPath, statementParent }, jsxElementPath)
            }
        }
        else if (t.isConditionalExpression(parentNode)) {
            const { consequent, alternate } = parentNode;
            const testExpression = parentPath.get('test');
            const block = jsx_1.buildBlockElement();
            if (utils_1.hasComplexExpression(testExpression)) {
                utils_1.generateAnonymousState(parentPath.scope, testExpression, this.referencedIdentifiers, true);
            }
            const test = testExpression.node;
            if (t.isJSXElement(consequent) && t.isLiteral(alternate)) {
                const { value, confident } = parentPath.get('alternate').evaluate();
                if (confident && !value) {
                    utils_1.newJSXIfAttr(block, test);
                    block.children = [jsxElementPath.node];
                    // newJSXIfAttr(jsxElementPath.node, test)
                    parentPath.replaceWith(block);
                    if (statementParent) {
                        const name = utils_1.findIdentifierFromStatement(statementParent.node);
                        utils_1.setTemplate(name, jsxElementPath, this.templates);
                        // name && templates.set(name, path.node)
                    }
                }
            }
            else if (t.isLiteral(consequent) && t.isJSXElement(alternate)) {
                if (t.isNullLiteral(consequent)) {
                    utils_1.newJSXIfAttr(block, utils_1.reverseBoolean(test));
                    // newJSXIfAttr(jsxElementPath.node, reverseBoolean(test))
                    block.children = [jsxElementPath.node];
                    parentPath.replaceWith(block);
                    if (statementParent) {
                        const name = utils_1.findIdentifierFromStatement(statementParent.node);
                        utils_1.setTemplate(name, jsxElementPath, this.templates);
                        // name && templates.set(name, path.node)
                    }
                }
            }
            else if (t.isJSXElement(consequent) && t.isJSXElement(alternate)) {
                const block2 = jsx_1.buildBlockElement();
                block.children = [consequent];
                utils_1.newJSXIfAttr(block, test);
                jsx_1.setJSXAttr(block2, 'wx:else');
                block2.children = [alternate];
                const parentBlock = jsx_1.buildBlockElement();
                parentBlock.children = [block, block2];
                parentPath.replaceWith(parentBlock);
                if (statementParent) {
                    const name = utils_1.findIdentifierFromStatement(statementParent.node);
                    utils_1.setTemplate(name, jsxElementPath, this.templates);
                }
            }
            else {
                block.children = [t.jSXExpressionContainer(consequent)];
                utils_1.newJSXIfAttr(block, test);
                const block2 = jsx_1.buildBlockElement();
                jsx_1.setJSXAttr(block2, 'wx:else');
                block2.children = [t.jSXExpressionContainer(alternate)];
                const parentBlock = jsx_1.buildBlockElement();
                parentBlock.children = [block, block2];
                parentPath.replaceWith(parentBlock);
                if (statementParent) {
                    const name = utils_1.findIdentifierFromStatement(statementParent.node);
                    utils_1.setTemplate(name, jsxElementPath, this.templates);
                }
            }
        }
    }
    setProperies() {
        const properties = [];
        this.componentProperies.forEach((propName) => {
            properties.push(t.objectProperty(t.stringLiteral(propName), t.nullLiteral()));
        });
        let classProp = t.classProperty(t.identifier('properties'), t.objectExpression(properties));
        classProp.static = true;
        const classPath = this.renderPath.findParent(isClassDcl);
        classPath.node.body.body.unshift(classProp);
    }
    addRefIdentifier(path, id) {
        const arrayMap = path.findParent(p => utils_1.isArrayMapCallExpression(p));
        if (arrayMap && arrayMap.isCallExpression()) {
            this.loopRefIdentifiers.set(id.name, arrayMap);
        }
        else {
            id && this.referencedIdentifiers.add(id);
        }
    }
    setOutputTemplate() {
        this.outputTemplate = jsx_1.parseJSXElement(this.finalReturnElement);
    }
    removeJSXStatement() {
        this.jsxDeclarations.forEach(d => d && d.remove());
        this.returnedPaths.forEach(p => p.remove());
    }
    setCustomEvent() {
        const classPath = this.renderPath.findParent(isClassDcl);
        let classProp = t.classProperty(t.identifier('$$events'), t.arrayExpression(Array.from(this.usedEvents).map(s => t.stringLiteral(s)))); // babel 6 typing 没有 static
        classProp.static = true;
        classPath.node.body.body.unshift(classProp);
    }
    setUsedState() {
        Array.from(this.reserveStateWords).forEach(this.setReserveWord);
        const usedState = Array.from(new Set(Array.from(this.referencedIdentifiers)
            .map(i => i.name)
            .concat([...this.initState, ...this.usedThisState])))
            .concat(...this.usedState)
            // .filter(i => {
            //   return !methods.has(i)
            // })
            .filter(i => !this.loopScopes.has(i))
            .filter(i => !this.templates.has(i));
        const classPath = this.renderPath.findParent(isClassDcl);
        classPath.node.body.body.unshift(t.classProperty(t.identifier('$usedState'), t.arrayExpression([...new Set(usedState
                .filter(s => !this.loopScopes.has(s.split('.')[0]))
                .filter(i => i !== constant_1.MAP_CALL_ITERATOR && !this.reserveStateWords.has(i))
                .filter(i => utils_1.isVarName(i))
                .filter(i => !this.loopRefIdentifiers.has(i))
                .concat(Array.from(this.customComponentNames)))]
            .map(s => t.stringLiteral(s)))));
    }
    setPendingState() {
        let properties = Array.from(new Set(Array.from(this.referencedIdentifiers)
            .map(i => i.name)))
            .filter(i => {
            return !this.methods.has(i);
        })
            .filter(i => !this.loopScopes.has(i))
            .filter(i => !this.initState.has(i))
            .filter(i => !this.templates.has(i))
            .filter(i => utils_1.isVarName(i))
            .filter(i => i !== constant_1.MAP_CALL_ITERATOR && !this.reserveStateWords.has(i))
            .filter(i => !i.startsWith('$$'))
            .filter(i => !this.loopRefIdentifiers.has(i))
            .map(i => t.objectProperty(t.identifier(i), t.identifier(i)));
        if (this.customComponentData.length > 0) {
            properties = properties.concat(this.customComponentData);
        }
        const pendingState = t.objectExpression(properties);
        this.renderPath.node.body.body = this.renderPath.node.body.body.concat(buildAssignState(pendingState), t.returnStatement(t.memberExpression(t.thisExpression(), t.identifier('state'))));
    }
    createData() {
        const renderBody = this.renderPath.get('body');
        renderBody.traverse({
            ThisExpression(path) {
                const property = path.getSibling('property');
                if (property.isIdentifier({ name: 'state' })) {
                    property.replaceWith(t.identifier('__state'));
                }
                if (property.isIdentifier({ name: 'props' })) {
                    property.replaceWith(t.identifier('__props'));
                }
            }
        });
        this.renderPath.node.body.body.unshift(template(`this.__state = arguments[0] || this.state || {};`)(), template(`this.__props = arguments[1] || this.props || {};`)());
        if (t.isIdentifier(this.renderPath.node.key)) {
            this.renderPath.node.key.name = '_createData';
        }
    }
}
exports.RenderParser = RenderParser;
//# sourceMappingURL=render.js.map