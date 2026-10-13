import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Header, HeaderAction } from '../components/Header';
import { AppDialog, type AppDialogData } from '../components/AppDialog';
import { JamIcon } from '../components/JamIcon';
import type { JamIconName } from '../lib/jamSvgMap';
import { legacyIoniconToJam } from '../lib/legacyIoniconToJam';
import { supabase } from '../lib/supabase';

interface RouteParams {
  listId?: string;
  listData?: {
    id: string;
    name: string;
    description?: string;
    icon_name: string;
    type: 'private' | 'shared';
  };
}

const GREEN = '#10A37F';
const TEAL = '#1B8A70';
const WHITE = '#FFFFFF';
const TITLE = '#241D13';
const MUTED = '#7A7878';
const BORDER = 'rgba(122, 120, 120, 0.35)';
const LABEL_GREY = '#868686';

const NewListScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const params = (route.params as RouteParams) || {};
  const isEditing = !!params.listId;

  const [listName, setListName] = useState('');
  const [description, setDescription] = useState('');
  const [listType, setListType] = useState<'private' | 'shared'>('private');
  const [selectedIcon, setSelectedIcon] = useState<JamIconName>('smiley');
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<AppDialogData | null>(null);

  const iconOptions: JamIconName[] = ['smiley', 'heart', 'star', 'bookmark', 'flag', 'bus', 'map-marker'];

  useEffect(() => {
    if (isEditing && params.listData) {
      setListName(params.listData.name);
      setDescription(params.listData.description || '');
      setListType(params.listData.type);
      setSelectedIcon(legacyIoniconToJam(params.listData.icon_name));
    }
  }, [isEditing, params.listData]);

  const cycleIcon = () => {
    const currentIndex = Math.max(0, iconOptions.indexOf(selectedIcon));
    const nextIndex = (currentIndex + 1) % iconOptions.length;
    setSelectedIcon(iconOptions[nextIndex]);
  };

  const handleSave = async () => {
    if (!listName.trim()) {
      setDialog({ title: 'Name required', message: 'Please enter a list name.', buttons: [{ label: 'OK', onPress: () => undefined }] });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setDialog({ title: 'Sign in required', message: 'You must be logged in to save a list.', buttons: [{ label: 'OK', onPress: () => undefined }] });
        setSaving(false);
        return;
      }

      if (isEditing && params.listId) {
        const { error } = await supabase
          .from('saved_lists')
          .update({
            name: listName.trim(),
            description: description.trim(),
            type: listType,
            icon_name: selectedIcon,
            updated_at: new Date().toISOString(),
          })
          .eq('id', params.listId)
          .eq('user_id', user.id);

        if (error) {
          console.error('Error updating list:', error);
          throw error;
        }

        setDialog({
          title: 'Changes saved',
          message: 'Your list was updated successfully. You can edit it again anytime from Saved List.',
          buttons: [{ label: 'OK', onPress: () => navigation.goBack() }],
        });
      } else {
        const { error } = await supabase
          .from('saved_lists')
          .insert({
            user_id: user.id,
            name: listName.trim(),
            description: description.trim(),
            type: listType,
            icon_name: selectedIcon,
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating list:', error);
          if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
            setDialog({
              title: 'Database error',
              message:
                'The saved_lists table does not exist. Please run the Supabase schema.sql file in your Supabase Dashboard > SQL Editor.',
              buttons: [{ label: 'OK', onPress: () => undefined }],
            });
          } else {
            throw error;
          }
          return;
        }

        setDialog({
          title: 'List saved',
          message: 'Your list was saved successfully. You can open and edit it anytime from Saved List.',
          buttons: [{ label: 'OK', onPress: () => navigation.goBack() }],
        });
      }
    } catch (error) {
      setDialog({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to save list. Please try again.',
        buttons: [{ label: 'OK', onPress: () => undefined }],
      });
      console.error('Error saving list:', error);
    } finally {
      setSaving(false);
    }
  };

  const canSave = listName.trim().length > 0;

  return (
    <View style={styles.root}>
      <Header
        title={isEditing ? 'Edit List' : 'New List'}
       
        showBack
        darkBackground
        right={
          <HeaderAction
            onPress={handleSave}
            disabled={saving || !canSave}
            accessibilityLabel={isEditing ? 'Save changes' : 'Save list'}
          >
            {saving ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <JamIcon ionicon="checkmark" size={24} color={canSave ? WHITE : 'rgba(255,255,255,0.45)'} />
            )}
          </HeaderAction>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 24) + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.emojiBlock}>
          <View style={styles.emojiCircleWrap}>
            <View style={styles.iconCircle}>
              <JamIcon name={selectedIcon} size={40} color={WHITE} />
            </View>
            <TouchableOpacity
              style={styles.plusBadge}
              onPress={cycleIcon}
              accessibilityLabel="Choose emoji"
              accessibilityRole="button"
            >
              <JamIcon name="plus" size={18} color={WHITE} />
            </TouchableOpacity>
          </View>
          <Text style={styles.emojiHint}>Choose an emoji</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Name this list"
          placeholderTextColor={LABEL_GREY}
          value={listName}
          onChangeText={setListName}
          accessibilityLabel="List name input"
          maxLength={100}
        />

        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Description"
          placeholderTextColor={LABEL_GREY}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          accessibilityLabel="List description input"
          maxLength={500}
        />

        <View style={styles.typeSection}>
          <Text style={styles.typeSectionLabel}>List type</Text>
          <View style={styles.typeHairline} />

          <TouchableOpacity
            style={styles.typeRow}
            onPress={() => setListType('private')}
            accessibilityLabel="Private list type"
            accessibilityRole="radio"
            accessibilityState={{ selected: listType === 'private' }}
          >
            <View style={styles.typeRowText}>
              <Text style={[styles.typeRowTitle, listType === 'private' && styles.typeRowTitleOn]}>
                Private
              </Text>
              <Text style={styles.typeRowDesc}>Only you can view and edit</Text>
            </View>
            {listType === 'private' ? (
              <JamIcon ionicon="checkmark" size={22} color={GREEN} />
            ) : (
              <View style={styles.typeRadioSpacer} />
            )}
          </TouchableOpacity>

          <View style={styles.typeHairline} />

          <TouchableOpacity
            style={styles.typeRow}
            onPress={() => setListType('shared')}
            accessibilityLabel="Shared list type"
            accessibilityRole="radio"
            accessibilityState={{ selected: listType === 'shared' }}
          >
            <View style={styles.typeRowText}>
              <Text style={[styles.typeRowTitle, listType === 'shared' && styles.typeRowTitleOn]}>
                Shared
              </Text>
              <Text style={styles.typeRowDesc}>
                Anyone with link will see this list with your account and picture
              </Text>
            </View>
            {listType === 'shared' ? (
              <JamIcon ionicon="checkmark" size={22} color={GREEN} />
            ) : (
              <View style={styles.typeRadioSpacer} />
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WHITE,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  emojiBlock: {
    alignItems: 'center',
    marginBottom: 28,
  },
  emojiCircleWrap: {
    position: 'relative',
    width: 100,
    height: 100,
    marginBottom: 10,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: WHITE,
  },
  emojiHint: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: MUTED,
  },
  input: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: TITLE,
    marginBottom: 14,
    minHeight: 48,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  typeSection: {
    marginTop: 8,
  },
  typeSectionLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: LABEL_GREY,
    marginBottom: 8,
  },
  typeHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  typeRowText: {
    flex: 1,
    paddingRight: 12,
  },
  typeRowTitle: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: MUTED,
    marginBottom: 4,
  },
  typeRowTitleOn: {
    color: GREEN,
    fontFamily: 'Poppins_700Bold',
  },
  typeRowDesc: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
  },
  typeRadioSpacer: {
    width: 22,
    height: 22,
  },
});

export default NewListScreen;
