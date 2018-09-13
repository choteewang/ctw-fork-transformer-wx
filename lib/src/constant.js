"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIND_EVENT_MAP = new Map();
exports.BIND_EVENT_MAP.set('onClick', 'bindtap');
exports.BIND_EVENT_MAP.set('onLongClick', 'bindlongtap');
exports.BIND_EVENT_MAP.set('onTouchMove', 'bindtouchmove');
exports.BIND_EVENT_MAP.set('onTouchEnd', 'bindtouchend');
exports.BIND_EVENT_MAP.set('onTouchstart', 'bindtouchend');
exports.BIND_EVENT_MAP.set('onChange', 'bindchange');
exports.BIND_EVENT_MAP.set('onInput', 'bindinput');
exports.BIND_EVENT_MAP.set('onScale', 'bindscale');
exports.BIND_EVENT_MAP.set('onAnimationFinish', 'bindanimationfinish');
exports.BIND_EVENT_MAP.set('onScroll', 'bindscroll');
exports.BIND_EVENT_MAP.set('onScrollToupper', 'bindscrolltoupper');
exports.BIND_EVENT_MAP.set('onContact', 'bindcontact');
exports.BIND_EVENT_MAP.set('onGetPhoneNumber', 'bindgetphonenumber');
exports.BIND_EVENT_MAP.set('onError', 'binderror');
exports.BIND_EVENT_MAP.set('onSubmit', 'bindsubmit');
exports.BIND_EVENT_MAP.set('onReset', 'bindReset');
exports.CATCH_EVENT_MAP = new Map();
exports.BIND_EVENT_MAP.forEach((value, key) => {
    exports.CATCH_EVENT_MAP.set(key, value);
});
exports.THIRD_PARTY_COMPONENTS = new Set();
// tslint:disable-next-line:variable-name
exports.DEFAULT_Component_SET = new Set([
    'View',
    'ScrollView',
    'Swiper',
    'MovableView',
    'CoverView',
    'CoverImage',
    'Icon',
    'Text',
    'RichText',
    'Progress',
    'Button',
    'Checkbox',
    'Form',
    'Input',
    'Label',
    'Picker',
    'PickerView',
    'PickerViewColumn',
    'Radio',
    'RadioGroup',
    'CheckboxGroup',
    'Slider',
    'Switch',
    'Textarea',
    'Navigator',
    'Audio',
    'Image',
    'Video',
    'Camera',
    'LivePlayer',
    'LivePusher',
    'Map',
    'Canvas',
    'OpenData',
    'WebView',
    'SwiperItem',
    'MovableArea',
    'MovableView',
    'FunctionalPageNavigator',
    'Ad',
    'Block',
    'span'
]);
exports.INTERNAL_SAFE_GET = 'internal_safe_get';
exports.TARO_PACKAGE_NAME = '@tarojs/taro';
exports.COMPONENTS_PACKAGE_NAME = '@tarojs/components';
exports.ASYNC_PACKAGE_NAME = '@tarojs/async-await';
exports.REDUX_PACKAGE_NAME = '@tarojs/redux';
exports.MAP_CALL_ITERATOR = '__item';
exports.INTERNAL_DYNAMIC = 'internal_dynamic_recursive';
exports.INTERNAL_INLINE_STYLE = 'internal_inline_style';
exports.LOOP_STATE = '$loopState';
exports.LOOP_CALLEE = '$anonymousCallee_';
exports.SPECIAL_COMPONENT_PROPS = new Map();
exports.SPECIAL_COMPONENT_PROPS.set('Progress', new Set([
    'activeColor',
    'backgroundColor'
]));
exports.IMAGE_COMPONENTS = new Set([
    'Image',
    'CoverImage'
]);
//# sourceMappingURL=constant.js.map