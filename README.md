This Minecraft Bedrock addon multiplies the length of daytime in your world.

**Basics**

*   You can set the daytime multiplier (default is 2 which equals double daytime)
*   Night will always progress in vanilla speed

**Behavior**

*   You can still go to sleep normally during nighttime or thunderstorms
*   Taking damage will still interrupt your sleep and not skip the night / storm
*   Weather will always reset to "clear" after successfully sleeping
*   It uses your world setting for how many players need to sleep in order to skip the night / storm
*   It should not interfer with normal day counting
*   The addon, by default, automatically enforces `doDayLightCycle` to be disabled, which is required for it to work. This behavior can be disabled for cases where you explicitly need it to be enabled.
*   It should be compatible with most other addons that rely on weather and time events. It uses normal commands to manipulate time and weather. These commands are issued in a player context if available, otherwise in dimension context. This allows, for example, to have addons like RealismCraft correctly register the weather change and disable the weather effects.
*   It strictly uses vanilla time ticks, so you can
    *   go to sleep at 12542 ticks (start of night) and
    *   wake up at 0 ticks (start of day)

**Setup**

*   Should be compatible with 1.21.0 and above
*   Requires cheats to be enabled - sorry about that, but this enabled us to execute commands in player context which is better for compatibility with other addons
*   You can modify the settings at the top of the file `scripts/main.js:`
    *   `DAY_MULTIPLIER`: Default is 2 for double day length. 3 would be triple day length etc.
    *   `ENABLE_AUTO_ENFORCER`: Default is true. Set it to false if you want to be able to manually control the gamerule `doDayLightCycle` - if you do, make sure to manually set the gamerule `doDayLightCycle` to false, otherwise the addon will not work.

**Important: I have only tested this on a Bedrock Dedicated Server but it should work in realms and normal worlds too.**

**Potential issues**

*   None known yet. Please report in comments if you find one.
