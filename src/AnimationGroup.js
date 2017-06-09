import chain from 'chain-function';
import React from 'react';
import ReactDom from 'react-dom';
import PropTypes from 'prop-types';
import warning from 'warning';

import { getChildMapping, mergeChildMappings } from './utils/ChildMapping';

const propTypes = {
  component: PropTypes.any,
  childFactory: PropTypes.func,
  children: PropTypes.node,
};

const defaultProps = {
  component: 'div',
  childFactory: child => child,
};


class AnimationGroup extends React.Component {
  static displayName = 'AnimationGroup';

  constructor(props, context) {
    super(props, context);

    this.childRefs = Object.create(null);

    this.state = {
      children: getChildMapping(props.children),
    };
  }

  componentWillMount() {
    this.animations = {};
    this.startingPositions = {};
    this.endingPositions = {};
    this.domNodes = {};
  }


  componentDidMount() {
    this.updateDomNodes();
  }

  componentWillReceiveProps(nextProps) {
    let nextChildMapping = getChildMapping(nextProps.children);
    let prevChildMapping = this.state.children;
    this.children = mergeChildMappings(prevChildMapping, nextChildMapping);

    this.setState({ children: this.children });

    this.leavingKeys = {};
    for (let key in prevChildMapping) {
      let hasNext = nextChildMapping && nextChildMapping.hasOwnProperty(key);
      if (prevChildMapping[key] && !hasNext) {
        this.leavingKeys[key] = true;
      }
    }
  }

  componentWillUpdate() {
    this.startingPositions = {};
    this.updateDomNodes();

    // Take a snapshot of the position of each child before the update
    for (let key in this.children) {
      this.startingPositions[key] = this.domNodes[key]
        ? this.domNodes[key].getBoundingClientRect()
        : {};
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps === this.props) return;

    this.updateDomNodes();
    for (let key in this.animations) this.animations[key]();

    // Take a snapshot of the real position where each child is after the update
    this.realPositions = {};
    for (let key in this.children) {
      const domNode = this.domNodes[key];
      this.realPositions[key] = domNode
        ? domNode.getBoundingClientRect()
        : {};
    }

    // Hiding all the nodes that will end up disapearring, so that we can
    // take a snapshot of the final position of each node.
    const originalDisplays = {};
    for (let key in this.leavingKeys) {
      const domNode = this.domNodes[key];
      if (domNode) {
        originalDisplays[key] = domNode && domNode.style.display;
        domNode.style.display = 'none';
      }
    }

    // Take a snapshot of where each child will end up being.
    // That's why we have temprarily hidden all the nodes that are going to disappear.
    this.endingPositions = {};
    for (let key in this.children) {
      const domNode = this.domNodes[key];
      this.endingPositions[key] = domNode
        ? domNode.getBoundingClientRect()
        : {};
    }

    // Restoring the original display values
    for (let key in originalDisplays) {
      this.domNodes[key].style.display = originalDisplays[key];
    }

    // Calculating the animations
    let animations = {};
    for (let key in this.children) {
      const first = this.startingPositions[key];
      const real = this.realPositions[key];
      const last = this.endingPositions[key];

      let [startLeft, startTop] = (!first.height && !first.width)
        ? [real.width * -1, real.top]
        : [first.left, first.top];

      let [endLeft, endTop] = (!last.height && !last.width)
        ? [real.width * -1, real.top]
        : [last.left, last.top];

      if (
        startLeft !== endLeft || startTop !== endTop ||
        endLeft !== real.left || endTop !== real.top
      ) {
        animations[key] = [
          { transform: `translate(${startLeft - real.left}px, ${startTop - real.top}px)` },
          { transform: `translate(${endLeft - real.left}px, ${endTop - real.top}px)` },
        ];
      }
    }

    // creating the animations with their "cancelation" functions
    for (let key in animations) {
      this.animations[key] = () => {
        this.domNodes[key].style.transition = '';
        this.domNodes[key].style.transform = '';
        delete this.animations[key];
      };
      this.domNodes[key].style.transform = animations[key][0].transform;
    }

    requestAnimationFrame(() => {
      for (let key in animations) {
        this.domNodes[key].style.transition = 'transform 0.5s cubic-bezier(0,0,0.32,1)';
      }
      requestAnimationFrame(() => {
        for (let key in animations) {
          this.domNodes[key].style.transform = animations[key][1].transform;
          this.domNodes[key].addEventListener('transitionend', () => {
            if (this.animations[key]) this.animations[key]();
            if (this.leavingKeys[key]) {
              delete this.children[key];
              delete this.childRefs[key];
              delete this.domNodes[key];
              delete this.startingPositions[key];
              delete this.endingPositions[key];
              delete this.leavingKeys[key];
              if (Object.keys(this.leavingKeys).length === 0) {
                for (let aKey in this.animations) this.animations[aKey]();
                this.setState({ children: this.children });
              }
            }
          });
        }
      });
    });
  }

  updateDomNodes() {
    for (let key in this.children) {
      this.domNodes[key] = ReactDom.findDOMNode(this.childRefs[key]);
    }
  }

  render() {
    let childrenToRender = [];
    for (let key in this.state.children) {
      let child = this.state.children[key];
      if (child) {
        let isCallbackRef = typeof child.ref !== 'string';
        let factoryChild = this.props.childFactory(child);
        let ref = (r) => {
          this.childRefs[key] = r;
        };

        warning(isCallbackRef,
          'string refs are not supported on children of AnimationGroup and will be ignored. ' +
          'Please use a callback ref instead: https://facebook.github.io/react/docs/refs-and-the-dom.html#the-ref-callback-attribute');

        // Always chaining the refs leads to problems when the childFactory
        // wraps the child. The child ref callback gets called twice with the
        // wrapper and the child. So we only need to chain the ref if the
        // factoryChild is not different from child.
        if (factoryChild === child && isCallbackRef) {
          ref = chain(child.ref, ref);
        }

        // You may need to apply reactive updates to a child as it is leaving.
        // The normal React way to do it won't work since the child will have
        // already been removed. In case you need this behavior you can provide
        // a childFactory function to wrap every child, even the ones that are
        // leaving.
        childrenToRender.push(React.cloneElement(
          factoryChild,
          {
            key,
            ref,
          },
        ));
      }
    }

    // Do not forward AnimationGroup props to primitive DOM nodes
    let props = Object.assign({}, this.props);
    delete props.transitionLeave;
    delete props.transitionName;
    delete props.transitionAppear;
    delete props.transitionEnter;
    delete props.childFactory;
    delete props.transitionLeaveTimeout;
    delete props.transitionEnterTimeout;
    delete props.transitionAppearTimeout;
    delete props.component;

    return React.createElement(
      this.props.component,
      props,
      childrenToRender,
    );
  }
}

AnimationGroup.propTypes = propTypes;
AnimationGroup.defaultProps = defaultProps;

export default AnimationGroup;

