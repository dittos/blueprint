/*
 * Copyright 2017 Palantir Technologies, Inc. All rights reserved.
 * Licensed under the BSD-3 License as modified (the “License”); you may obtain a copy
 * of the license at https://github.com/palantir/blueprint/blob/master/LICENSE
 * and https://github.com/palantir/blueprint/blob/master/PATENTS
 */

import * as React from "react";

import { IProps, Keys, Utils } from "@blueprintjs/core";

export interface IListItemsProps<T> extends IProps {
    /** Array of items in the list. */
    items: T[];

    /** Customize filtering of individual items. Return `true` to keep the item, `false` to hide. */
    itemPredicate?: (item: T, query: string) => boolean;

    /**
     * Customize filtering of entire items array. Return subset of items that pass filter.
     * (Some filter algorithms operate on the entire set, rather than individual items.)
     */
    itemListPredicate?: (items: T[], query: string) => T[];

    /**
     * Callback invoked when an item from the list is selected,
     * typically by clicking or pressing `enter` key.
     */
    onItemSelect: (item: T, event: React.SyntheticEvent<HTMLElement>) => void;
}

export interface IInputListProps<T> extends IListItemsProps<T> {
    /**
     * The active item is the current keyboard-focused element.
     * Listen to `onActiveItemChange` for updates from interactions.
     */
    activeItem: T;

    /**
     * Invoked when user interaction should change the active item: arrow keys move it up/down
     * in the list, selecting an item makes it active, and changing the query may reset it to
     * the first item in the list if it no longer matches the filter.
     */
    onActiveItemChange: (activeItem: T) => void;

    /**
     * Callback invoked when user presses a key, after processing `InputList`'s own key events
     * (up/down to navigate active item). This callback is passed to `compose` and (along with
     * `onKeyUp`) can be attached to arbitrary content elements to support keyboard selection.
     */
    onKeyDown?: React.KeyboardEventHandler<HTMLElement>;

    /**
     * Callback invoked when user releases a key, after processing `InputList`'s own key events
     * (enter to select active item). This callback is passed to `compose` and (along with
     * `onKeyDown`) can be attached to arbitrary content elements to support keyboard selection.
     */
    onKeyUp?: React.KeyboardEventHandler<HTMLElement>;

    /**
     * Customize rendering of the input list.
     * Receives an object with props that should be applied to elements as necessary.
     */
    renderer: (listProps: IInputListRendererProps<T>) => JSX.Element;

    /**
     * Query string passed to `itemListPredicate` or `itemPredicate` to filter items.
     * This value is controlled: its state must be managed externally by attaching an `onChange`
     * handler to the relevant element in your `renderer` implementation.
     */
    query: string;
}

/**
 * An object with the following properties will be passed to an `InputList` `renderer`.
 * Required properties will always be defined;  optional ones will only be defined if
 * they are passed as props to the `InputList`.
 *
 * This interface is generic, accepting a type parameter `<T>` for an item in the list.
 */
export interface IInputListRendererProps<T> extends IProps {
    /** The item focused by the keyboard (arrow keys). This item should stand out visually from the rest. */
    activeItem: T;

    /**
     * Array of filtered items from the list (those that matched the predicate with the current `query`).
     * See `items` for the full unfiltered list.
     */
    filteredItems: T[];

    /**
     * Selection handler that should be invoked when a new item has been chosen,
     * perhaps because the user clicked it.
     */
    handleItemSelect: (item: T, event: React.SyntheticEvent<HTMLElement>) => void;

    /**
     * Keyboard handler for up/down arrow keys to shift the active item.
     * Attach this handler to any element that should support this interaction.
     */
    handleKeyDown: React.KeyboardEventHandler<HTMLElement>;

    /**
     * Keyboard handler for enter key to select the active item.
     * Attach this handler to any element that should support this interaction.
     */
    handleKeyUp: React.KeyboardEventHandler<HTMLElement>;

    /**
     * Array of all (unfiltered) items in the list.
     * See `filteredItems` for a filtered array based on `query`.
     */
    items: T[];

    /**
     * A ref handler that should be applied to the HTML element that contains the rendererd items.
     * This is required for the `InputList` to scroll the active item into view automatically.
     */
    itemsParentRef: (ref: HTMLElement) => void;

    /**
     * Controlled text value of the filter input. Attach an `onChange` handler to the relevant
     * element to control this prop from your application's state.
     */
    query: string;
}

export interface IInputListState<T> {
    filteredItems?: T[];
}

export class InputList<T> extends React.Component<IInputListProps<T>, IInputListState<T>> {
    public static displayName = "Blueprint.InputList";

    public static ofType<T>() {
        return InputList as new (props: IInputListProps<T>) => InputList<T>;
    }

    private itemsParentRef: HTMLElement;
    private refHandlers = {
        itemsParent: (ref: HTMLElement) => this.itemsParentRef = ref,
    };

    /**
     * flag indicating that we should check whether selected item is in viewport after rendering,
     * typically because of keyboard change.
     */
    private shouldCheckActiveItemInViewport: boolean;

    public render() {
        const { renderer, ...props } = this.props;
        const { filteredItems } = this.state;
        return renderer({
            ...props,
            filteredItems,
            handleItemSelect: this.handleItemSelect,
            handleKeyDown: this.handleKeyDown,
            handleKeyUp: this.handleKeyUp,
            itemsParentRef: this.refHandlers.itemsParent,
        });
    }

    public componentWillMount() {
        this.setState({ filteredItems: getFilteredItems(this.props) });
    }

    public componentWillReceiveProps(nextProps: IInputListProps<T>) {
        if (nextProps.items !== this.props.items
            || nextProps.itemListPredicate !== this.props.itemListPredicate
            || nextProps.itemPredicate !== this.props.itemPredicate
            || nextProps.query !== this.props.query
        ) {
            this.shouldCheckActiveItemInViewport = true;
            this.setState({ filteredItems: getFilteredItems(nextProps) });
        }
    }

    public componentDidUpdate() {
        if (this.shouldCheckActiveItemInViewport) {
            // update scroll position immediately before repaint so DOM is accurate
            // (latest filteredItems) and to avoid flicker.
            requestAnimationFrame(() => this.scrollActiveItemIntoView());
            // reset the flag
            this.shouldCheckActiveItemInViewport = false;
        }
        // reset active item (in the same step) if it's no longer valid
        if (this.getActiveIndex() < 0) {
            Utils.safeInvoke(this.props.onActiveItemChange, this.state.filteredItems[0]);
        }
    }

    public scrollActiveItemIntoView() {
        const activeElement = this.getActiveElement();
        if (this.itemsParentRef != null && activeElement != null) {
            const { offsetTop: activeTop, offsetHeight: activeHeight } = activeElement;
            const {
                offsetTop: parentOffsetTop,
                scrollTop: parentScrollTop,
                clientHeight: parentHeight,
            } = this.itemsParentRef;
            // compute padding on parent element to ensure we always leave space
            const { paddingTop, paddingBottom } = this.getItemsParentPadding();

            // compute the two edges of the active item for comparison, including parent padding
            const activeBottomEdge = activeTop + activeHeight + paddingBottom - parentOffsetTop;
            const activeTopEdge = activeTop - paddingTop - parentOffsetTop;

            if (activeBottomEdge >= parentScrollTop + parentHeight) {
                // offscreen bottom: align bottom of item with bottom of viewport
                this.itemsParentRef.scrollTop = activeBottomEdge + activeHeight - parentHeight;
            } else if (activeTopEdge <= parentScrollTop) {
                // offscreen top: align top of item with top of viewport
                this.itemsParentRef.scrollTop = activeTopEdge - activeHeight;
            }
        }
    }

    private getActiveElement() {
        if (this.itemsParentRef != null) {
            return this.itemsParentRef.children.item(this.getActiveIndex()) as HTMLElement;
        }
        return undefined;
    }

    private getActiveIndex() {
        // NOTE: this operation is O(n) so it should be avoided in render(). safe for events though.
        return this.state.filteredItems.indexOf(this.props.activeItem);
    }

    private getItemsParentPadding() {
        const { paddingTop, paddingBottom } = getComputedStyle(this.itemsParentRef);
        return {
            paddingBottom: pxToNumber(paddingBottom),
            paddingTop: pxToNumber(paddingTop),
        };
    }

    private handleItemSelect = (item: T, event: React.SyntheticEvent<HTMLElement>) => {
        Utils.safeInvoke(this.props.onActiveItemChange, item);
        Utils.safeInvoke(this.props.onItemSelect, item, event);
    }

    private handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        switch (event.keyCode) {
            case Keys.ARROW_UP:
                event.preventDefault();
                this.moveActiveIndex(-1);
                break;
            case Keys.ARROW_DOWN:
                event.preventDefault();
                this.moveActiveIndex(1);
                break;
            default: return;
        }
        Utils.safeInvoke(this.props.onKeyDown, event);
    }

    private handleKeyUp = (event: React.KeyboardEvent<HTMLElement>) => {
        const { activeItem, onItemSelect, onKeyUp } = this.props;
        // using keyup for enter to play nice with Button's keyboard clicking.
        // if we were to process enter on keydown, then Button would click itself on keyup
        // and the popvoer would re-open out of our control :(.
        if (event.keyCode === Keys.ENTER) {
            event.preventDefault();
            Utils.safeInvoke(onItemSelect, activeItem, event);
        }
        Utils.safeInvoke(onKeyUp, event);
    }

    private moveActiveIndex(direction: number) {
        // indicate that the active item may need to be scrolled into view after update.
        // this is not possible with mouse hover cuz you can't hover on something off screen.
        this.shouldCheckActiveItemInViewport = true;
        const { filteredItems } = this.state;
        const maxIndex = Math.max(filteredItems.length - 1, 0);
        const nextActiveIndex = Utils.clamp(this.getActiveIndex() + direction, 0, maxIndex);
        Utils.safeInvoke(this.props.onActiveItemChange, filteredItems[nextActiveIndex]);
    }
}

function pxToNumber(value: string) {
    return parseInt(value.slice(0, -2), 10);
}

function getFilteredItems<T>({ items, itemPredicate, itemListPredicate, query }: IInputListProps<T>) {
    if (Utils.isFunction(itemListPredicate)) {
        // TODO: this can reorder the items, which can cause weirdness while filtering. do some design.
        return itemListPredicate(items, query);
    } else if (Utils.isFunction(itemPredicate)) {
        return items.filter((item) => itemPredicate(item, query));
    }
    return items;
}
