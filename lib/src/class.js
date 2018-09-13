"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const t = require("babel-types");
const utils_1 = require("./utils");
const constant_1 = require("./constant");
const lodash_1 = require("lodash");
const render_1 = require("./render");
const jsx_1 = require("./jsx");
const babel_generator_1 = require("babel-generator");
function buildConstructor() {
    const ctor = t.classMethod('constructor', t.identifier('constructor'), [t.identifier('props')], t.blockStatement([
        t.expressionStatement(t.callExpression(t.identifier('super'), [
            t.identifier('props')
        ]))
    ]));
    return ctor;
}
function processThisPropsFnMemberProperties(member, path, args) {
    const propertyArray = [];
    function traverseMember(member) {
        const object = member.object;
        const property = member.property;
        if (t.isIdentifier(property)) {
            propertyArray.push(property.name);
        }
        if (t.isMemberExpression(object)) {
            if (t.isThisExpression(object.object) &&
                t.isIdentifier(object.property) &&
                object.property.name === 'props') {
                path.replaceWith(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')), [t.stringLiteral(propertyArray.reverse().join('.')), t.callExpression(t.memberExpression(t.arrayExpression([t.nullLiteral()]), t.identifier('concat')), [t.arrayExpression(args)])]));
            }
            traverseMember(object);
        }
    }
    traverseMember(member);
}
class Transformer {
    constructor(path, sourcePath) {
        this.result = {
            template: '',
            components: []
        };
        this.methods = new Map();
        this.initState = new Set();
        this.jsxReferencedIdentifiers = new Set();
        this.customComponents = new Map();
        this.anonymousMethod = new Map();
        this.renderMethod = null;
        this.customComponentNames = new Set();
        this.usedState = new Set();
        this.loopStateName = new Map();
        this.customComponentData = [];
        this.componentProperies = new Set();
        this.refs = [];
        this.buildAnonymousFunc = (attr, expr, isBind = false) => {
            const { code } = babel_generator_1.default(expr);
            if (code.startsWith('this.props')) {
                const methodName = utils_1.findMethodName(expr);
                const hasMethodName = this.anonymousMethod.has(methodName) || !methodName;
                const funcName = hasMethodName
                    ? this.anonymousMethod.get(methodName)
                    // 测试时使用1个稳定的 uniqueID 便于测试，实际使用5个英文字母，否则小程序不支持
                    : process.env.NODE_ENV === 'test' ? lodash_1.uniqueId('func__') : `func__${utils_1.createRandomLetters(5)}`;
                this.anonymousMethod.set(methodName, funcName);
                const newVal = isBind
                    ? t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier(funcName)), t.identifier('bind')), expr.arguments || [])
                    : t.memberExpression(t.thisExpression(), t.identifier(funcName));
                attr.get('value.expression').replaceWith(newVal);
                this.methods.set(funcName, null);
                this.componentProperies.add(methodName);
                if (hasMethodName) {
                    return;
                }
                const attrName = attr.node.name;
                if (t.isJSXIdentifier(attrName) && attrName.name.startsWith('on')) {
                    this.componentProperies.add(`__fn_${attrName.name}`);
                }
                if (methodName.startsWith('on')) {
                    this.componentProperies.add(`__fn_${methodName}`);
                }
                const method = t.classMethod('method', t.identifier(funcName), [], t.blockStatement([
                    t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')), [t.stringLiteral(methodName), t.arrayExpression([t.spreadElement(t.identifier('arguments'))])]))
                ]));
                this.classPath.node.body.body = this.classPath.node.body.body.concat(method);
            }
        };
        this.classPath = path;
        this.sourcePath = sourcePath;
        this.moduleNames = Object.keys(path.scope.getAllBindings('module'));
        this.compile();
    }
    createStringRef(componentName, id, refName) {
        this.refs.push({
            type: constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
            id,
            refName
        });
    }
    createFunctionRef(componentName, id, fn) {
        this.refs.push({
            type: constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
            id,
            fn
        });
    }
    handleRefs() {
        const objExpr = this.refs.map(ref => {
            return t.objectExpression([
                t.objectProperty(t.identifier('type'), t.stringLiteral(ref.type)),
                t.objectProperty(t.identifier('id'), t.stringLiteral(ref.id)),
                t.objectProperty(t.identifier('refName'), t.stringLiteral(ref.refName || '')),
                t.objectProperty(t.identifier('fn'), ref.fn ? ref.fn : t.nullLiteral())
            ]);
        });
        this.classPath.node.body.body.push(t.classProperty(t.identifier('$$refs'), t.arrayExpression(objExpr)));
    }
    traverse() {
        const self = this;
        self.classPath.traverse({
            JSXOpeningElement: (path) => {
                const jsx = path.node;
                const attrs = jsx.attributes;
                if (!t.isJSXIdentifier(jsx.name)) {
                    return;
                }
                const componentName = jsx.name.name;
                const refAttr = jsx_1.findJSXAttrByName(attrs, 'ref');
                if (!refAttr) {
                    return;
                }
                const idAttr = jsx_1.findJSXAttrByName(attrs, 'id');
                let id = utils_1.createRandomLetters(5);
                if (!idAttr) {
                    attrs.push(t.jSXAttribute(t.jSXIdentifier('id'), t.stringLiteral(id)));
                }
                else {
                    const idValue = idAttr.value;
                    if (t.isStringLiteral(idValue)) {
                        id = idValue.value;
                    }
                    else if (t.isJSXExpressionContainer(idValue) && t.isStringLiteral(idValue.expression)) {
                        id = idValue.expression.value;
                    }
                }
                if (t.isStringLiteral(refAttr.value)) {
                    this.createStringRef(componentName, id, refAttr.value.value);
                }
                if (t.isJSXExpressionContainer(refAttr.value)) {
                    const expr = refAttr.value.expression;
                    if (t.isStringLiteral(expr)) {
                        this.createStringRef(componentName, id, expr.value);
                    }
                    else if (t.isArrowFunctionExpression(expr) || t.isMemberExpression(expr)) {
                        this.refs.push({
                            type: constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
                            id,
                            fn: expr
                        });
                    }
                    else {
                        throw utils_1.codeFrameError(refAttr, 'ref 仅支持传入字符串、匿名箭头函数和 class 中已声明的函数');
                    }
                }
                for (const [index, attr] of attrs.entries()) {
                    if (attr === refAttr) {
                        attrs.splice(index, 1);
                    }
                }
            },
            ClassMethod(path) {
                const node = path.node;
                if (t.isIdentifier(node.key)) {
                    const name = node.key.name;
                    self.methods.set(name, path);
                    if (name === 'render') {
                        self.renderMethod = path;
                    }
                    if (name === 'constructor') {
                        path.traverse({
                            AssignmentExpression(p) {
                                if (t.isMemberExpression(p.node.left) &&
                                    t.isThisExpression(p.node.left.object) &&
                                    t.isIdentifier(p.node.left.property) &&
                                    p.node.left.property.name === 'state' &&
                                    t.isObjectExpression(p.node.right)) {
                                    const properties = p.node.right.properties;
                                    properties.forEach(p => {
                                        if (t.isObjectProperty(p) && t.isIdentifier(p.key)) {
                                            self.initState.add(p.key.name);
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            },
            IfStatement(path) {
                const test = path.get('test');
                const consequent = path.get('consequent');
                if (utils_1.isContainJSXElement(consequent) && utils_1.hasComplexExpression(test)) {
                    const scope = self.renderMethod && self.renderMethod.scope || path.scope;
                    utils_1.generateAnonymousState(scope, test, self.jsxReferencedIdentifiers, true);
                }
            },
            ClassProperty(path) {
                const { key: { name }, value } = path.node;
                if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
                    self.methods.set(name, path);
                }
                if (name === 'state' && t.isObjectExpression(value)) {
                    value.properties.forEach(p => {
                        if (t.isObjectProperty(p)) {
                            if (t.isIdentifier(p.key)) {
                                self.initState.add(p.key.name);
                            }
                        }
                    });
                }
            },
            JSXExpressionContainer(path) {
                path.traverse({
                    MemberExpression(path) {
                        const sibling = path.getSibling('property');
                        if (path.get('object').isThisExpression() &&
                            path.get('property').isIdentifier({ name: 'props' }) &&
                            sibling.isIdentifier()) {
                            const attr = path.findParent(p => p.isJSXAttribute());
                            const isFunctionProp = attr && typeof attr.node.name.name === 'string' && attr.node.name.name.startsWith('on');
                            if (!isFunctionProp) {
                                self.usedState.add(sibling.node.name);
                            }
                        }
                    }
                });
                const expression = path.get('expression');
                const scope = self.renderMethod && self.renderMethod.scope || path.scope;
                const calleeExpr = expression.get('callee');
                if (utils_1.hasComplexExpression(expression) &&
                    !(calleeExpr &&
                        calleeExpr.isMemberExpression() &&
                        calleeExpr.get('object').isMemberExpression() &&
                        calleeExpr.get('property').isIdentifier({ name: 'bind' })) // is not bind
                ) {
                    utils_1.generateAnonymousState(scope, expression, self.jsxReferencedIdentifiers);
                }
                const attr = path.findParent(p => p.isJSXAttribute());
                if (!attr)
                    return;
                const key = attr.node.name;
                const value = attr.node.value;
                if (t.isJSXIdentifier(key) && key.name.startsWith('on') && t.isJSXExpressionContainer(value)) {
                    const expr = value.expression;
                    if (t.isCallExpression(expr) && t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property, { name: 'bind' })) {
                        self.buildAnonymousFunc(attr, expr, true);
                    }
                    else if (t.isMemberExpression(expr)) {
                        self.buildAnonymousFunc(attr, expr, false);
                    }
                    else {
                        throw utils_1.codeFrameError(expr.loc, '组件事件传参只能在类作用域下的确切引用(this.handleXX || this.props.handleXX)，或使用 bind。');
                    }
                }
            },
            JSXElement(path) {
                const id = path.node.openingElement.name;
                if (t.isJSXIdentifier(id) &&
                    !constant_1.DEFAULT_Component_SET.has(id.name) &&
                    self.moduleNames.indexOf(id.name) !== -1) {
                    const name = id.name;
                    const binding = self.classPath.scope.getBinding(name);
                    if (binding && t.isImportDeclaration(binding.path.parent)) {
                        const sourcePath = binding.path.parent.source.value;
                        if (binding.path.isImportDefaultSpecifier()) {
                            self.customComponents.set(name, {
                                sourcePath,
                                type: 'default'
                            });
                        }
                        else {
                            self.customComponents.set(name, {
                                sourcePath,
                                type: 'pattern'
                            });
                        }
                    }
                }
            },
            MemberExpression(path) {
                const object = path.get('object');
                const property = path.get('property');
                if (!(object.isThisExpression() && property.isIdentifier({ name: 'props' }))) {
                    return;
                }
                const parentPath = path.parentPath;
                if (parentPath.isMemberExpression()) {
                    const siblingProp = parentPath.get('property');
                    if (siblingProp.isIdentifier()) {
                        const name = siblingProp.node.name;
                        if (name === 'children') {
                            parentPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [], true), t.jSXClosingElement(t.jSXIdentifier('slot')), [], true));
                        }
                        else {
                            self.componentProperies.add(siblingProp.node.name);
                        }
                    }
                }
                else if (parentPath.isVariableDeclarator()) {
                    const siblingId = parentPath.get('id');
                    if (siblingId.isObjectPattern()) {
                        const properties = siblingId.node.properties;
                        for (const prop of properties) {
                            if (t.isRestProperty(prop)) {
                                throw utils_1.codeFrameError(prop.loc, 'this.props 不支持使用 rest property 语法，请把每一个 prop 都单独列出来');
                            }
                            else if (t.isIdentifier(prop.key)) {
                                self.componentProperies.add(prop.key.name);
                            }
                        }
                    }
                }
            },
            CallExpression(path) {
                const node = path.node;
                const callee = node.callee;
                if (t.isMemberExpression(callee) && t.isMemberExpression(callee.object)) {
                    const property = callee.property;
                    if (t.isIdentifier(property)) {
                        if (property.name.startsWith('on')) {
                            self.componentProperies.add(`__fn_${property.name}`);
                            processThisPropsFnMemberProperties(callee, path, node.arguments);
                        }
                        else if (property.name === 'call' || property.name === 'apply') {
                            self.componentProperies.add(`__fn_${property.name}`);
                            processThisPropsFnMemberProperties(callee.object, path, node.arguments);
                        }
                    }
                }
            }
        });
    }
    setComponents() {
        this.customComponents.forEach((component, name) => {
            this.result.components.push({
                path: utils_1.pathResolver(component.sourcePath, this.sourcePath),
                name: lodash_1.kebabCase(name),
                type: component.type
            });
        });
    }
    resetConstructor() {
        const body = this.classPath.node.body.body;
        if (!this.methods.has('constructor')) {
            const ctor = buildConstructor();
            body.unshift(ctor);
        }
        if (process.env.NODE_ENV === 'test') {
            return;
        }
        for (const method of body) {
            if (t.isClassMethod(method) && method.kind === 'constructor') {
                method.kind = 'method';
                method.key = t.identifier('_constructor');
                if (t.isBlockStatement(method.body)) {
                    for (const statement of method.body.body) {
                        if (t.isExpressionStatement(statement)) {
                            const expr = statement.expression;
                            if (t.isCallExpression(expr) && (t.isIdentifier(expr.callee, { name: 'super' }) || t.isSuper(expr.callee))) {
                                expr.callee = t.memberExpression(t.identifier('super'), t.identifier('_constructor'));
                            }
                        }
                    }
                }
            }
        }
    }
    handleLifecyclePropParam(propParam, properties) {
        let propsName = null;
        if (!propParam) {
            return null;
        }
        if (t.isIdentifier(propParam)) {
            propsName = propParam.name;
        }
        else if (t.isObjectPattern(propParam)) {
            for (const prop of propParam.properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                    properties.add(prop.key.name);
                }
                else if (t.isRestProperty(prop) && t.isIdentifier(prop.argument)) {
                    propsName = prop.argument.name;
                }
            }
        }
        else {
            throw utils_1.codeFrameError(propParam.loc, '此生命周期的第一个参数只支持写标识符或对象解构');
        }
        return propsName;
    }
    findMoreProps() {
        // 第一个参数是 props 的生命周期
        const lifeCycles = new Set([
            // 'constructor',
            'componentDidUpdate',
            'shouldComponentUpdate',
            'getDerivedStateFromProps',
            'getSnapshotBeforeUpdate',
            'componentWillReceiveProps',
            'componentWillUpdate'
        ]);
        const properties = new Set();
        this.methods.forEach((method, name) => {
            if (!lifeCycles.has(name)) {
                return;
            }
            const node = method.node;
            let propsName = null;
            if (t.isClassMethod(node)) {
                propsName = this.handleLifecyclePropParam(node.params[0], properties);
            }
            else if (t.isArrowFunctionExpression(node.value) || t.isFunctionExpression(node.value)) {
                propsName = this.handleLifecyclePropParam(node.value.params[0], properties);
            }
            if (propsName === null) {
                return;
            }
            method.traverse({
                MemberExpression(path) {
                    if (!path.isReferencedMemberExpression()) {
                        return;
                    }
                    const { object, property } = path.node;
                    if (t.isIdentifier(object, { name: propsName }) && t.isIdentifier(property)) {
                        properties.add(property.name);
                    }
                },
                VariableDeclarator(path) {
                    const { id, init } = path.node;
                    if (t.isObjectPattern(id) && t.isIdentifier(init, { name: propsName })) {
                        for (const prop of id.properties) {
                            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                                properties.add(prop.key.name);
                            }
                        }
                    }
                }
            });
            properties.forEach((value) => {
                this.componentProperies.add(value);
            });
        });
    }
    parseRender() {
        if (this.renderMethod) {
            this.result.template = this.result.template
                + new render_1.RenderParser(this.renderMethod, this.methods, this.initState, this.jsxReferencedIdentifiers, this.usedState, this.loopStateName, this.customComponentNames, this.customComponentData, this.componentProperies).outputTemplate;
        }
        else {
            throw utils_1.codeFrameError(this.classPath.node.loc, '没有定义 render 方法');
        }
    }
    compile() {
        this.traverse();
        this.setComponents();
        this.resetConstructor();
        this.findMoreProps();
        this.handleRefs();
        this.parseRender();
    }
}
exports.Transformer = Transformer;
//# sourceMappingURL=class.js.map